import "dotenv/config";  
import express from 'express';
import cors from 'cors';
import authRoutes from './Routes/authRoutes.js';
import connect from './config/config.js';
import redisClient from "./config/redis.js";
import cookieParser from "cookie-parser";
import walletRoutes from './Routes/walletRoutes.js';
import paymentRoutes from './Routes/paymentRoutes.js';

const app = express();
app.use(cors({
    origin: process.env.MODE === 'production' ? process.env.APP_URL : 'http://localhost:5173',
    credentials: true,
    methods: ['GET','POST','PUT','DELETE'],
    allowedHeaders: ['Content-Type','Authorization']
}));


const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use('/auth', authRoutes);
app.use('/wallet', walletRoutes);
app.use('/payments', paymentRoutes);

connect();

app.listen(PORT, () =>{
    if(redisClient.isOpen) {
        console.log("✅ Redis is connected and ready to use");
    }
    console.log(`Server is running on port ${PORT}`);
});