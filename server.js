const express = require('express');
const mongoose = require('mongoose');
const { MongoClient, GridFSBucket } = require('mongodb');
const socketIo = require('socket.io');
const http = require('http');
const cors = require('cors');
const User = require('./models/User');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "DELETE"]
    }
});

const port = process.env.PORT || 3000;

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
    .then(() => console.log("Connected to MongoDB successfully"))
    .catch((err) => console.error("Error connecting to MongoDB: ", err));

// Schema for Message
const messageSchema = new mongoose.Schema({
    senderId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
    receiverId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
    message: { type: String },
    imgUrl: { type: String, default: null },
    imgstr: { type: String, default: null },  // Store Base64 image string
    timeStamp: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', messageSchema);

// Helper function to create chat room ID
const createChatRoomId = (id1, id2) => {
    return [id1, id2].sort().join('_');
};

// Send message endpoint
app.post('/send-message', async (req, res) => {
    const { senderId, receiverId, message, imgstr } = req.body;

    if (!senderId || !receiverId || (!message && !imgstr)) {
        return res.status(400).json({ error: 'Message or Base64 image string is required' });
    }

    try {
        const sender = await User.findById(senderId);
        const receiver = await User.findById(receiverId);
        if (!sender || !receiver) {
            return res.status(404).json({ error: 'User not found' });
        }

        const chatRoomId = createChatRoomId(senderId, receiverId);
        
        let chatRoom = await ChatRoom.findById(chatRoomId);
        if (!chatRoom) {
            chatRoom = new ChatRoom({
                _id: chatRoomId,
                users: [senderId, receiverId],
                messages: []
            });
            await chatRoom.save();
        }

        // If there's an image in the message, convert it to buffer and store in GridFS
        let imgFileId = null;
        if (imgstr) {
            const buffer = Buffer.from(imgstr, 'base64');

            const client = await MongoClient.connect(process.env.MONGODB_URI, {
                useNewUrlParser: true,
                useUnifiedTopology: true
            });

            const db = client.db();
            const bucket = new GridFSBucket(db, { bucketName: 'images' });

            const uploadStream = bucket.openUploadStream('image.jpg');  // You can set a dynamic name
            uploadStream.end(buffer, () => {
                imgFileId = uploadStream.id;  // Save the GridFS file ID
            });
        }

        const newMessage = new Message({
            senderId,
            receiverId,
            message,
            imgstr: imgFileId ? imgFileId.toString() : null,  // Store the GridFS file ID
        });

        const savedMessage = await newMessage.save();

        chatRoom.messages.push(savedMessage._id);
        await chatRoom.save();

        io.emit('newMessage', savedMessage);
        res.status(201).json(savedMessage);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error sending message' });
    }
});

// Retrieve image from GridFS as Base64 string
app.get('/get-image/:fileId', async (req, res) => {
    const { fileId } = req.params;

    try {
        const client = await MongoClient.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });

        const db = client.db();
        const bucket = new GridFSBucket(db, { bucketName: 'images' });

        // Open a read stream from GridFS
        const downloadStream = bucket.openDownloadStream(mongoose.Types.ObjectId(fileId));

        let data = [];
        downloadStream.on('data', chunk => {
            data.push(chunk);
        });

        downloadStream.on('end', () => {
            // Convert the chunks into a Base64 string
            const imgBuffer = Buffer.concat(data);
            const base64String = imgBuffer.toString('base64');
            res.status(200).json({ base64String });  // Return the image as Base64
        });

        downloadStream.on('error', (err) => {
            console.error(err);
            res.status(500).json({ error: 'Error retrieving image' });
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error connecting to MongoDB' });
    }
});

server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
