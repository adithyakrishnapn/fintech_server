import "dotenv/config";
import express from 'express';
import cors from 'cors';
import authRoutes from './Routes/authRoutes.js';
import connect from './config/config.js';
import redisClient from "./config/redis.js";
import cookieParser from "cookie-parser";
import walletRoutes from './Routes/walletRoutes.js';
import paymentRoutes from './Routes/paymentRoutes.js';

import { createServer } from 'http';
import { Server } from 'socket.io';
import Message from './models/messageSchema.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: process.env.MODE === 'production' ? process.env.APP_URL : 'http://localhost:5173',
        methods: ['GET', 'POST'],
        credentials: true
    }
});

app.use(cors({
    origin: process.env.MODE === 'production' ? process.env.APP_URL : 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));


const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use('/auth', authRoutes);
app.use('/wallet', walletRoutes);
app.use('/payments', paymentRoutes);
import chatRoutes from './Routes/chatRoutes.js';
app.use('/chat', chatRoutes);

// Socket.io Logic
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join_room', (userId) => {
        socket.join(userId);
        console.log(`User ${userId} joined room ${userId}`);
    });

    socket.on('send_message', async (data) => {
        // data: { senderId, receiverId, content }
        const { senderId, receiverId, content } = data;

        // Save to DB
        try {
            const newMessage = new Message({ senderId, receiverId, content });
            await newMessage.save();

            // Emit to receiver
            io.to(receiverId).emit('receive_message', newMessage);
            // Emit back to sender (for confirmation/optimistic UI update if needed, though they usually have it)
            io.to(senderId).emit('receive_message', newMessage);

        } catch (error) {
            console.error("Error saving message:", error);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

connect();

httpServer.listen(PORT, () => {
    if (redisClient.isOpen) {
        console.log("✅ Redis is connected and ready to use");
    }
    console.log(`Server is running on port ${PORT}`);
});