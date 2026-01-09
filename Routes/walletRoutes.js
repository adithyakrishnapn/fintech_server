import express from 'express';
import mongoose from 'mongoose';
import { User, Wallet, Transaction, Transfer } from '../models/mainSchema.js';
import { creditWallet, walletToWalletTransfer, debitWallet } from '../services/ledger.service.js';
import auth from '../middleware/authMiddleWare.js';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});


router.post("/transfer", auth, async (req, res) => {
  try {
    const { toUserId, amount } = req.body;

    if (!toUserId || !amount || amount <= 0) {
      return res.status(400).json({ message: "Valid recipient and amount required" });
    }

    const fromWallet = await Wallet.findOne({ userId: req.user.userId });
    if (!fromWallet) {
      return res.status(404).json({ message: "Your wallet not found" });
    }

    // Check if wallet has sufficient balance
    if (fromWallet.balance < amount) {
      return res.status(400).json({ message: "Insufficient balance" });
    }

    // Verify PIN
    const user = await User.findById(req.user.userId);
    if (!user.transactionPin) {
      return res.status(400).json({ message: "Transaction PIN not set. Please set it in dashboard." });
    }

    // We assume 'pin' is passed in req.body
    const { pin } = req.body;

    // DEBUG LOGS (Remove in production)
    console.log(`[Transfer] User: ${req.user.userId}, Received PIN: ${pin}, Stored Hash: ${user.transactionPin}`);

    if (!pin) {
      return res.status(400).json({ message: "PIN is required" });
    }

    const isPinValid = await bcrypt.compare(pin, user.transactionPin);
    console.log(`[Transfer] PIN Valid: ${isPinValid}`);

    if (!isPinValid) {
      return res.status(400).json({ message: "Invalid Transaction PIN" });
    }

    // Find recipient by multiple criteria: MongoDB ObjectId, phone, or email
    let toUser = null;

    // Try to find by ObjectId first
    if (mongoose.Types.ObjectId.isValid(toUserId)) {
      toUser = await User.findById(toUserId);
    }

    // If not found, try by phone or email
    if (!toUser) {
      toUser = await User.findOne({
        $or: [
          { phone: toUserId },
          { email: toUserId }
        ]
      });
    }

    if (!toUser) {
      return res.status(404).json({ message: "Recipient not found. Please check the ID/phone/email." });
    }

    // Don't allow self-transfer
    if (toUser._id.toString() === req.user.userId.toString()) {
      return res.status(400).json({ message: "Cannot transfer to yourself" });
    }

    const toWallet = await Wallet.findOne({ userId: toUser._id });
    if (!toWallet) {
      return res.status(404).json({ message: "Recipient wallet not found" });
    }

    const transfer = await walletToWalletTransfer({
      fromWalletId: fromWallet._id,
      toWalletId: toWallet._id,
      amount
    });

    res.json({
      message: "Transfer successful",
      transfer,
      recipient: {
        name: toUser.name,
        phone: toUser.phone
      }
    });
  } catch (error) {
    console.error("Transfer error:", error);
    res.status(500).json({ message: "Transfer failed", error: error.message });
  }
});


router.post("/withdraw", auth, async (req, res) => {
  try {
    const { amount, upiId } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Valid amount required" });
    }

    if (!upiId) {
      return res.status(400).json({ message: "UPI ID required" });
    }

    const wallet = await Wallet.findOne({ userId: req.user.userId });
    if (!wallet) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    // Check if wallet has sufficient balance
    if (wallet.balance < amount) {
      return res.status(400).json({ message: "Insufficient balance" });
    }

    // Check if Razorpay Payouts is enabled
    const enableRazorpayPayouts = process.env.ENABLE_RAZORPAY_PAYOUTS === 'true';

    if (enableRazorpayPayouts) {
      try {
        // 1. Create contact for the user (if not exists)
        const contact = await razorpay.contacts.create({
          name: req.user.name || "User",
          email: req.user.email,
          contact: req.user.phone || "9999999999",
          type: "customer",
          reference_id: req.user.userId.toString(),
          notes: {
            userId: req.user.userId.toString()
          }
        }).catch(err => {
          // Contact might already exist, try to fetch it
          if (err.error && err.error.description && err.error.description.includes('already exists')) {
            return razorpay.contacts.fetch({ reference_id: req.user.userId.toString() });
          }
          throw err;
        });

        // 2. Create fund account for UPI
        const fundAccount = await razorpay.fundAccount.create({
          contact_id: contact.id,
          account_type: "vpa",
          vpa: {
            address: upiId
          }
        });

        // 3. Create Razorpay Payout to send actual money
        const payout = await razorpay.payouts.create({
          account_number: process.env.RAZORPAY_ACCOUNT_NUMBER,
          fund_account_id: fundAccount.id,
          amount: Math.round(amount * 100), // Amount in paise
          currency: "INR",
          mode: "UPI",
          purpose: "payout",
          queue_if_low_balance: false,
          reference_id: `payout_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          narration: "Wallet withdrawal",
          notes: {
            userId: req.user.userId.toString(),
            upiId: upiId
          }
        });

        // 4. Only debit wallet if payout was created successfully
        await debitWallet({
          walletId: wallet._id,
          amount,
          referenceId: payout.id,
          description: `Withdrawal to UPI: ${upiId}`
        });

        res.json({
          message: "Withdrawal successful",
          payoutId: payout.id,
          status: payout.status,
          utr: payout.utr
        });

      } catch (payoutError) {
        console.error("Payout creation failed:", payoutError);
        return res.status(500).json({
          message: "Payout failed. Your wallet has not been debited.",
          error: payoutError.message
        });
      }
    } else {
      // Simulated withdrawal (for development/testing)
      const referenceId = `sim_payout_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

      try {
        await debitWallet({
          walletId: wallet._id,
          amount,
          referenceId: referenceId,
          description: `Simulated withdrawal to UPI: ${upiId}`
        });

        res.json({
          message: "Withdrawal initiated (simulated)",
          payoutId: referenceId,
          status: "simulated",
          utr: `SIM${Date.now()}`,
          note: "This is a simulated withdrawal. Enable Razorpay Payouts for real transfers."
        });
      } catch (debitError) {
        console.error("Debit wallet error:", debitError);
        return res.status(500).json({
          message: "Failed to debit wallet",
          error: debitError.message
        });
      }
    }

  } catch (error) {
    console.error("Withdrawal error:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({ message: "Withdrawal failed", error: error.message });
  }
});


// Payout webhook to handle payout status updates
router.post("/payout-webhook", async (req, res) => {
  try {
    const { event, payload } = req.body;

    if (event === "payout.processed") {
      // Payout successful - already debited wallet when created
      console.log("Payout processed successfully:", payload.payout.entity.id);
    } else if (event === "payout.failed" || event === "payout.reversed") {
      // Payout failed - need to credit back the wallet
      const payoutId = payload.payout.entity.id;
      const userId = payload.payout.entity.notes?.userId;
      const amount = payload.payout.entity.amount / 100;

      if (userId) {
        const wallet = await Wallet.findOne({ userId });
        if (wallet) {
          // Credit back the amount since payout failed
          await creditWallet({
            walletId: wallet._id,
            amount,
            referenceId: payoutId,
            description: `Payout reversal: ${payoutId}`
          });
          console.log(`Refunded ${amount} to wallet ${wallet._id} for failed payout ${payoutId}`);
        }
      }
    }

    res.status(200).json({ message: "Webhook processed" });
  } catch (error) {
    console.error("Payout webhook error:", error);
    res.status(500).json({ message: "Webhook processing failed" });
  }
});


router.get("/transactions", auth, async (req, res) => {
  try {
    const { limit = 50, skip = 0 } = req.query;

    const wallet = await Wallet.findOne({ userId: req.user.userId }).populate('userId', 'name email phone');
    if (!wallet) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    // Get all transactions for this wallet
    const transactions = await Transaction.find({
      walletId: wallet._id
    }).sort({ createdAt: -1 }).limit(parseInt(limit)).skip(parseInt(skip));

    // Get transfers involving this wallet
    const transfers = await Transfer.find({
      $or: [
        { fromWallet: wallet._id },
        { toWallet: wallet._id }
      ],
      status: "SUCCESS"
    })
      .populate('fromWallet')
      .populate('toWallet')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    // Enrich transfer data with user information
    const enrichedTransfers = await Promise.all(transfers.map(async (transfer) => {
      const isReceived = transfer.toWallet._id.toString() === wallet._id.toString();
      const otherWalletId = isReceived ? transfer.fromWallet.userId : transfer.toWallet.userId;
      const otherUser = await User.findById(otherWalletId).select('name email phone');

      return {
        id: transfer._id,
        type: isReceived ? 'received' : 'sent',
        amount: transfer.amount,
        sender: isReceived ? otherUser?.name : wallet.userId?.name,
        receiver: !isReceived ? otherUser?.name : wallet.userId?.name,
        otherUser: otherUser ? {
          name: otherUser.name,
          phone: otherUser.phone,
          email: otherUser.email
        } : null,
        date: transfer.createdAt,
        status: transfer.status,
        category: 'transfer'
      };
    }));

    // Format basic transactions
    const formattedTransactions = transactions.map(tx => ({
      id: tx._id,
      type: tx.type.toLowerCase(),
      amount: tx.amount,
      description: tx.description,
      referenceId: tx.referenceId,
      date: tx.createdAt,
      category: tx.description?.includes('Add money') ? 'topup' :
        tx.description?.includes('Withdrawal') ? 'withdrawal' : 'other'
    }));

    // Combine and sort all activities
    const allActivities = [...enrichedTransfers, ...formattedTransactions]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, parseInt(limit));

    res.json({
      transactions: allActivities,
      total: allActivities.length,
      wallet: {
        balance: wallet.balance,
        status: wallet.status
      }
    });
  } catch (error) {
    console.error("Transactions error:", error);
    res.status(500).json({ message: "Failed to fetch transactions", error: error.message });
  }
});

// Recent activities endpoint for homepage
router.get("/recent-activities", auth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;

    const wallet = await Wallet.findOne({ userId: req.user.userId }).populate('userId', 'name email');
    if (!wallet) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    // Get recent transfers
    const transfers = await Transfer.find({
      $or: [
        { fromWallet: wallet._id },
        { toWallet: wallet._id }
      ],
      status: "SUCCESS"
    })
      .sort({ createdAt: -1 })
      .limit(limit);

    // Enrich with user data
    const activities = await Promise.all(transfers.map(async (transfer) => {
      const isReceived = transfer.toWallet.toString() === wallet._id.toString();
      const otherWalletId = isReceived ? transfer.fromWallet : transfer.toWallet;
      const otherWallet = await Wallet.findById(otherWalletId).populate('userId', 'name phone');
      const otherUser = otherWallet?.userId;

      return {
        id: transfer._id,
        type: isReceived ? 'received' : 'sent',
        amount: transfer.amount,
        sender: isReceived ? (otherUser?.name || 'Unknown') : wallet.userId?.name,
        receiver: !isReceived ? (otherUser?.name || 'Unknown') : wallet.userId?.name,
        date: new Date(transfer.createdAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        }),
        avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${isReceived ? otherUser?.name : wallet.userId?.name}`
      };
    }));

    res.json({ activities });
  } catch (error) {
    console.error("Recent activities error:", error);
    res.status(500).json({ message: "Failed to fetch activities", error: error.message });
  }
});

router.get("/balance", auth, async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ userId: req.user.userId });
    if (!wallet) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    res.json({ balance: wallet.balance, status: wallet.status });
  } catch (error) {
    console.error("Balance error:", error);
    res.status(500).json({ message: "Failed to fetch balance", error: error.message });
  }
});


export default router;