import express from 'express';
import { Transaction } from '../models/mainSchema.js';
import Message from '../models/messageSchema.js';
import { User } from '../models/mainSchema.js';

const router = express.Router();

// Get list of contacts (people transacted with)
router.get('/contacts/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        // Find transactions where user is sender or receiver (via Wallet)
        // Need to find Wallet ID for the user first? 
        // Based on previous exploration, Transaction links Wallets, and Wallet links User.
        // But mainSchema says Transaction -> Wallet (ObjectId).
        // Let's check mainSchema again. Transaction has `walletId`. But it also needs a "to/from"?
        // Wait, mainSchema has `Transfer` for P2P? And `Transaction` for Ledger?

        // Let's check `Transfer` schema in mainSchema.js
        // transferSchema: fromWallet, toWallet.

        // So we need to find Transfers where fromWallet.userId = userId OR toWallet.userId = userId.

        // 1. Find User's Wallet
        const userWallet = await mongoose.model('Wallet').findOne({ userId });
        if (!userWallet) return res.status(404).json({ message: "Wallet not found" });

        // 2. Find Transfers
        const transfers = await mongoose.model('Transfer').find({
            $or: [{ fromWallet: userWallet._id }, { toWallet: userWallet._id }]
        }).populate({
            path: 'fromWallet',
            populate: { path: 'userId', select: 'name email phone' }
        }).populate({
            path: 'toWallet',
            populate: { path: 'userId', select: 'name email phone' }
        });

        // 3. Extract unique contacts
        const contactsMap = new Map();

        transfers.forEach(t => {
            const otherWallet = t.fromWallet._id.equals(userWallet._id) ? t.toWallet : t.fromWallet;
            if (otherWallet && otherWallet.userId) {
                const otherUser = otherWallet.userId;
                if (!contactsMap.has(otherUser._id.toString())) {
                    contactsMap.set(otherUser._id.toString(), {
                        _id: otherUser._id,
                        name: otherUser.name,
                        email: otherUser.email,
                        phone: otherUser.phone
                    });
                }
            }
        });

        const contacts = Array.from(contactsMap.values());
        res.status(200).json(contacts);

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
});

// Get messages between two users
router.get('/messages/:userId/:otherId', async (req, res) => {
    try {
        const { userId, otherId } = req.params;
        const messages = await Message.find({
            $or: [
                { senderId: userId, receiverId: otherId },
                { senderId: otherId, receiverId: userId }
            ]
        }).sort({ createdAt: 1 });

        res.status(200).json(messages);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
});

export default router;
