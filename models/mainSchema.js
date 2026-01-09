import mongoose from "mongoose";

/* ===========================
   USER
=========================== */
const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    unique: true,
    required: true
  },
  email: {
    type: String,
    unique: true,
    sparse: true   // allows null values
  },
  password: {
    type: String   // hashed password
  },
  transactionPin: {
    type: String // hashed pin
  },
  //   kycLevel: {
  //     type: String,
  //     enum: ["MIN", "FULL"],
  //     default: "MIN"
  //   },
  status: {
    type: String,
    enum: ["ACTIVE", "BLOCKED"],
    default: "ACTIVE"
  }
}, { timestamps: true });

/* ===========================
   WALLET
=========================== */
const walletSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    unique: true,
    required: true
  },
  balance: {
    type: Number,
    default: 0,
    min: 0
  },
  status: {
    type: String,
    enum: ["ACTIVE", "FROZEN"],
    default: "ACTIVE"
  }
}, { timestamps: true });

/* ===========================
   TRANSACTION (LEDGER)
=========================== */
const transactionSchema = new mongoose.Schema({
  walletId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Wallet",
    required: true
  },
  type: {
    type: String,
    enum: ["CREDIT", "DEBIT"],
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  referenceId: {
    type: String  // Changed from ObjectId to String to support both ObjectId strings and custom reference strings
  },
  description: {
    type: String
  }
}, { timestamps: true });

/* ===========================
   TRANSFER
=========================== */
const transferSchema = new mongoose.Schema({
  fromWallet: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Wallet",
    required: true
  },
  toWallet: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Wallet",
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ["PENDING", "SUCCESS", "FAILED"],
    default: "PENDING"
  }
}, { timestamps: true });

/* ===========================
   MODELS EXPORT
=========================== */
const User = mongoose.model("User", userSchema);
const Wallet = mongoose.model("Wallet", walletSchema);
const Transaction = mongoose.model("Transaction", transactionSchema);
const Transfer = mongoose.model("Transfer", transferSchema);

export {
  User,
  Wallet,
  Transaction,
  Transfer
};
