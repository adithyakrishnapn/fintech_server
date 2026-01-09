import express from 'express';
import { User, Wallet } from '../models/mainSchema.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import redisClient from '../config/redis.js';
import authMiddleware from '../middleware/authMiddleWare.js';
const router = express.Router();


router.post('/signup', async (req, res) => {
    try {
        const { name, phone, email, password } = req.body;

        if (name && phone && password && email) {
            const checkuser = await User.findOne({ email: email });
            if (checkuser) {
                return res.status(400).json({ message: "User already exists" });
            } else {
                const hashedPassword = await bcrypt.hash(password, 10);
                const newUser = new User({
                    name,
                    phone,
                    email,
                    password: hashedPassword
                })
                await newUser.save();
                const wallet = new Wallet({
                    userId: newUser._id,
                    balance: 0
                });
                await wallet.save();
                res.status(201).json({ message: "User created successfully" });
            }
        } else {
            res.status(400).json({ message: "All fields are required" });
        }
    } catch (error) {
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];

            return res.status(409).json({
                message: `${field} already exists`,
            });
        }

        console.error("Signup Error:", error);
        return res.status(500).json({
            message: "Internal server error",
        });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: "Email and Password are required" });
        }

        const user = await User.findOne({ email: email });
        if (!user) {
            return res.status(400).json({ message: "Invalid email or password" });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: "Invalid email or password" });
        }

        const token = jwt.sign(
            {
                userId: user._id,
                email: user.email
            },
            process.env.JWT_SECRET,
            {
                expiresIn: '7d'
            }
        )

        await redisClient.set(
            `token:${user._id}`,
            token,
            { EX: 7 * 24 * 60 * 60 * 1000 }
        );

        res.cookie("accessToken", token, {
            httpOnly: true,
            secure: true,       // true in production (HTTPS)
            sameSite: "None", // adjust as needed
            path: "/",
            maxAge: 7 * 24 * 60 * 60 * 1000
        });
        res.status(200).json({ message: "Login successful", token });
    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ message: "Server Error", error: error.message });
    }
})

router.get("/me", authMiddleware, (req, res) => {

    res.status(200).json({ user: req.user });

});

router.get("/details", authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).select("-password");
        const wallet = await Wallet.findOne({ userId: req.user.userId });

        res.status(200).json({ user, wallet });
    } catch (error) {
        console.error("Details Error:", error);
        res.status(500).json({ message: "Server Error", error: error.message });
    }
});

router.post("/logout", authMiddleware, async (req, res) => {
    await redisClient.del(`token:${req.user.userId}`);

    res.clearCookie("accessToken");

    res.json({ message: "Logged out successfully" });
});


router.post("/set-pin", authMiddleware, async (req, res) => {
    try {
        const { pin, password } = req.body;

        if (!pin || pin.length < 4) {
            return res.status(400).json({ message: "PIN must be at least 4 digits" });
        }

        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Verify password before setting PIN for security (if provided, or enforce it?)
        // User didn't strictly ask for password verification but it's good practice. 
        // Let's assume for now just setting it if logged in is enough, OR require password.
        // Let's stick to simple: if they are logged in, they can set it. 
        // Better: if they already have a PIN, require old PIN? 
        // For now, let's just allow setting it.

        const hashedPin = await bcrypt.hash(pin, 10);
        user.transactionPin = hashedPin;
        await user.save();

        console.log(`[Set PIN] User: ${req.user.userId}, PIN: ${pin}, Hash: ${hashedPin}`);

        res.status(200).json({ message: "Transaction PIN set successfully" });
    } catch (error) {
        console.error("Set PIN Error:", error);
        res.status(500).json({ message: "Server Error", error: error.message });
    }
});

router.post("/verify-pin", authMiddleware, async (req, res) => {
    try {
        const { pin } = req.body;
        const user = await User.findById(req.user.userId);

        if (!user || !user.transactionPin) {
            return res.status(400).json({ message: "PIN not set" });
        }

        const isMatch = await bcrypt.compare(pin, user.transactionPin);
        if (!isMatch) {
            return res.status(400).json({ message: "Invalid PIN" });
        }

        res.status(200).json({ message: "PIN verified" });
    } catch (error) {
        res.status(500).json({ message: "Server Error" });
    }
});

export default router;