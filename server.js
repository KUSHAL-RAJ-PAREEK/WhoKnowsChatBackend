const express = require('express');
const mongoose = require('mongoose');
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

io.on('connection', (socket) => {
    console.log('User connected');
    
    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
    .then(() => console.log("Connected to MongoDB successfully"))
    .catch((err) => console.error("Error connecting to MongoDB: ", err));

    const mongoose = require('mongoose');

    const messageSchema = new mongoose.Schema({
        _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
        senderId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
        receiverId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
        message: { type: String },
        imgStr1: { type: String, default: null },  
        imgStr2: { type: String, default: null }, 
        timeStamp: { type: Date, default: Date.now }
    });
    
    
    const Message = mongoose.model('Message', messageSchema);
    
const chatRoomSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    messages: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Message' }]
});
const ChatRoom = mongoose.model('ChatRoom', chatRoomSchema);

const createChatRoomId = (id1, id2) => {
    return [id1, id2].sort().join('_');
};

app.post('/send-message', async (req, res) => {
    const { senderId, receiverId, message, imgUrl, imgStr1,imgStr2 } = req.body;  
    console.log(senderId, receiverId, message, imgUrl, imgStr1,imgStr2);

    if (!senderId || !receiverId || (!message && !imgUrl && !imgStr1 && !imgStr2)) {
        return res.status(400).json({ error: 'Message, image URL, or Base64 string is required' });
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

        const newMessage = new Message({ senderId, receiverId, message, imgUrl, imgStr1, imgStr2 }); 
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


app.get('/message/:chatRoomId', async (req, res) => {
    const chatRoomId = req.params.chatRoomId;
    try {
        const chatRoom = await ChatRoom.findById(chatRoomId).populate('messages');
        if (!chatRoom) {
            return res.status(404).json({ error: 'Chat room not found' });
        }
        res.status(200).json(chatRoom.messages);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error getting messages' });
    }
});


app.delete('/delete-message/:messageId', async (req, res) => {
    const { messageId } = req.params;

    try {
        const message = await Message.findById(messageId);
        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }

        await Message.findByIdAndDelete(messageId);
        io.emit('messageDeleted', messageId);

        res.status(200).json({ message: 'Message deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error deleting message' });
    }
});

server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
