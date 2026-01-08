import express from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import auth from '../middleware/authMiddleWare.js';
import { Wallet } from '../models/mainSchema.js';
import { creditWallet } from '../services/ledger.service.js';

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Create Razorpay order to add money
router.post('/add-money', auth, async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valid amount required' });
    }

    const amountInPaise = Math.round(amount * 100);
    const receipt = `rcpt_${Date.now().toString()}_${crypto.randomBytes(3).toString('hex')}`;

    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt,
      notes: {
        userId: req.user.userId.toString(),
        email: req.user.email
      }
    });

    res.json({
      message: 'Order created successfully',
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: process.env.RAZORPAY_KEY_ID
    });
  } catch (error) {
    console.error('Add money error:', error);
    res.status(500).json({ message: 'Failed to create order', error: error.message });
  }
});

// Create an order and return an in-app payment link hosted on our domain
router.post('/request-link', auth, async (req, res) => {
  try {
    const { amount, description, to } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valid amount required' });
    }

    const amountInPaise = Math.round(amount * 100);
    const receipt = `req_${Date.now().toString()}_${crypto.randomBytes(3).toString('hex')}`;

    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt,
      notes: {
        userId: req.user.userId.toString(),
        email: req.user.email,
        description: description || 'Payment Request',
        to: to || ''
      }
    });

    const frontUrl = process.env.APP_URL || 'http://localhost:5173';
    const params = new URLSearchParams({
      orderId: order.id,
      amount: String(amount),
      currency: order.currency,
      key_id: process.env.RAZORPAY_KEY_ID,
      desc: description || 'Payment Request',
      to: to || ''
    }).toString();

    const payUrl = `${frontUrl}/pay?${params}`;

    res.json({
      message: 'Request link created',
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: process.env.RAZORPAY_KEY_ID,
      payUrl
    });
  } catch (error) {
    console.error('Request link error:', error);
    res.status(500).json({ message: 'Failed to create request link', error: error.message });
  }
});

// Webhook for add-money orders
router.post('/webhook', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
    hmac.update(razorpay_order_id + '|' + razorpay_payment_id);
    const generated_signature = hmac.digest('hex');

    if (generated_signature !== razorpay_signature) {
      return res.status(400).json({ message: 'Invalid signature' });
    }

    const payment = await razorpay.payments.fetch(razorpay_payment_id);
    if (payment.status !== 'captured') {
      return res.status(400).json({ message: 'Payment not captured' });
    }

    const userId = payment.notes.userId;
    const amount = payment.amount / 100;

    const wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      return res.status(404).json({ message: 'Wallet not found' });
    }

    await creditWallet({
      walletId: wallet._id,
      amount,
      referenceId: razorpay_payment_id,
      description: `Add money via Razorpay (Order: ${razorpay_order_id})`
    });

    res.status(200).json({ message: 'Payment verified and wallet credited' });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ message: 'Webhook processing failed', error: error.message });
  }
});

// Client-side verification fallback (use when webhooks are not configured)
router.post('/verify-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: 'Missing payment verification fields' });
    }

    const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
    hmac.update(razorpay_order_id + '|' + razorpay_payment_id);
    const generated_signature = hmac.digest('hex');

    if (generated_signature !== razorpay_signature) {
      return res.status(400).json({ message: 'Invalid signature' });
    }

    const payment = await razorpay.payments.fetch(razorpay_payment_id);
    if (payment.status !== 'captured') {
      return res.status(400).json({ message: 'Payment not captured' });
    }

    const amount = payment.amount / 100;
    const userId = payment.notes?.userId;
    const wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      return res.status(404).json({ message: 'Wallet not found' });
    }

    await creditWallet({
      walletId: wallet._id,
      amount,
      referenceId: razorpay_payment_id,
      description: `Add money via Razorpay (Order: ${razorpay_order_id})`
    });

    const updatedWallet = await Wallet.findById(wallet._id);
    res.json({ message: 'Payment verified and wallet credited', balance: updatedWallet.balance });
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({ message: 'Failed to verify payment', error: error.message });
  }
});

// Razorpay Payment Link creation
router.post('/create-payment-link', auth, async (req, res) => {
  try {
    const { amount, description } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valid amount required' });
    }

    const link = await razorpay.paymentLink.create({
      amount: Math.round(amount * 100),
      currency: 'INR',
      description: description || 'Add money to wallet',
      customer: { email: req.user.email },
      notify: { sms: false, email: true },
      notes: {
        userId: req.user.userId.toString(),
        email: req.user.email
      }
    });

    res.json({
      message: 'Payment link created',
      short_url: link.short_url,
      id: link.id,
      amount: link.amount,
      currency: link.currency
    });
  } catch (error) {
    console.error('Create payment link error:', error);
    res.status(500).json({ message: 'Failed to create payment link', error: error.message });
  }
});

// Webhook for Razorpay payment links
router.post('/payment-link-webhook', async (req, res) => {
  try {
    const { payload } = req.body;

    if (!payload || !payload.payment_link) {
      return res.status(400).json({ message: 'Invalid webhook payload' });
    }

    const paymentLinkData = payload.payment_link;
    const paymentId = payload.payment ? payload.payment.id : null;

    if (paymentLinkData.status !== 'completed') {
      return res.status(200).json({ message: 'Payment link not completed yet' });
    }

    if (!paymentId) {
      return res.status(400).json({ message: 'Payment ID required for verification' });
    }

    const payment = await razorpay.payments.fetch(paymentId);

    if (payment.status !== 'captured') {
      return res.status(400).json({ message: 'Payment not captured' });
    }

    const userId = payment.notes?.userId;
    const amount = payment.amount / 100;

    if (!userId) {
      return res.status(400).json({ message: 'User ID not found in payment notes' });
    }

    const wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      return res.status(404).json({ message: 'Wallet not found' });
    }

    await creditWallet({
      walletId: wallet._id,
      amount,
      referenceId: paymentId,
      description: `Add money via Payment Link (${paymentLinkData.id})`
    });

    res.status(200).json({ message: 'Payment link verified and wallet credited' });
  } catch (error) {
    console.error('Payment link webhook error:', error);
    res.status(500).json({ message: 'Webhook processing failed', error: error.message });
  }
});

export default router;
