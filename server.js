const express = require('express');
const mongoose = require('mongoose');
const socketIo = require('socket.io');
const http = require('http');
const cors = require('cors');
const User = require('./models/User');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
app.use(express.json({ limit: '50mb' }))

app.use(cors());
app.use(express.json());

const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "DELETE"]
    }
});

const chatRoomTypingMap = new Map(); 

const port = process.env.PORT || 3000;

io.on('connection', (socket) => {
    console.log('User connected');
 
   
    socket.on('typing', ({ chatRoomId, userId }) => {
        console.log('User typing:', chatRoomId, userId);
        if (!chatRoomTypingMap.has(chatRoomId)) {
            chatRoomTypingMap.set(chatRoomId, new Set());
        }
        console.log(chatRoomTypingMap)
        let typingUsers = chatRoomTypingMap.get(chatRoomId);
        typingUsers.add(userId); 

        io.emit('userTyping', {chatRoomId,typingUsers: Array.from(typingUsers)});
        console.log('Typing users:', typingUsers);

    });

    socket.on('stopTyping', ({ chatRoomId, userId }) => {
        if (chatRoomTypingMap.has(chatRoomId)) {
            let typingUsers = chatRoomTypingMap.get(chatRoomId);
            typingUsers.delete(userId); 

            if (typingUsers.size === 0) {
                chatRoomTypingMap.delete(chatRoomId);
            } else {
                io.emit('userTyping', Array.from(typingUsers));
            }
        }
    });
    
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

    const messageSchema = new mongoose.Schema({
        _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
        senderId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
        receiverId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
        message: { type: String },
        imgUrl: { type: String, default: null },
        imgStr: { type: String, default: null },  
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

const acceptationSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    count: { type: Number, required: true },
    acceptedUsers: { type: Map, of: Boolean, default: {} }
});

const Acceptation = mongoose.model('Acceptation', acceptationSchema);

app.post('/send-message', async (req, res) => {
    const { senderId, receiverId, message, imgUrl, imgStr } = req.body;  
    console.log(senderId, receiverId, message, imgUrl, imgStr);

    if (!senderId || !receiverId || (!message && !imgUrl && !imgStr)) {
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

        const newMessage = new Message({ senderId, receiverId, message, imgUrl, imgStr }); 
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


app.put('/edit-message/:messageId', async (req, res) => {
    const { messageId } = req.params;

    if (!messageId) {
        return res.status(400).json({ error: 'New message id is required' });
    }

    try {
        const message = await Message.findById(messageId);
        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }
        const newMessage = "deleted";
        message.message = newMessage; 
        message.imgUrl = null;
        message.imgStr = null;
        
        await message.save();

        io.emit('messageUpdated', [ messageId, newMessage ]);

        res.status(200).json({ message: 'Message updated successfully', updatedMessage: message });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error updating message' });
    }
});


app.put('/accept/:id', async (req, res) => {
    const { id } = req.params;
    const { count, userId } = req.body;

    if (typeof count !== 'number' || !userId) {
        return res.status(400).json({ error: 'Invalid count or userId' });
    }

    try {
        const updatedAccept = await Acceptation.findByIdAndUpdate(
            id,
            { 
                count,
                $set: { [`acceptedUsers.${userId}`]: true } 
            },
            { new: true, upsert: true } 
        );

        res.status(200).json(updatedAccept);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error updating acceptation' });
    }
});



app.get('/accept/:id', async (req, res) => {
    try {
        const acceptation = await Acceptation.findById(req.params.id);
        if (!acceptation) {
            return res.status(404).json({ error: 'Acceptation not found' });
        }
        res.status(200).json({ count: acceptation.count });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error retrieving acceptation' });
    }
});


app.get('/accept/:id/user/:userId', async (req, res) => {
    const { id, userId } = req.params;

    try {
        const acceptation = await Acceptation.findById(id);

        if (!acceptation || !acceptation.acceptedUsers.get(userId)) {
            return res.status(404).json({ error: 'User not found in acceptation' });
        }

        res.status(200).json({ message: 'User has accepted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error checking acceptation' });
    }
});



server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
