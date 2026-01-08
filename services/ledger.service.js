import { Wallet, Transaction } from '../models/mainSchema.js';
import mongoose from "mongoose";
import { Transfer } from "../models/mainSchema.js";

export async function creditWallet({
  walletId,
  amount,
  referenceId = null,
  description = ""
}, session = null) {

  const wallet = await Wallet.findById(walletId).session(session);
  if (!wallet || wallet.status !== "ACTIVE") {
    throw new Error("Wallet not active");
  }

  wallet.balance += amount;
  await wallet.save({ session: session || undefined });

  const txData = {
    walletId,
    type: "CREDIT",
    amount,
    referenceId,
    description
  };

  if (session) {
    await Transaction.create([txData], { session });
  } else {
    await Transaction.create(txData);
  }
}


export async function debitWallet({
  walletId,
  amount,
  referenceId = null,
  description = ""
}, session = null) {

  const wallet = await Wallet.findById(walletId).session(session);
  if (!wallet || wallet.status !== "ACTIVE") {
    throw new Error("Wallet not active");
  }

  if (wallet.balance < amount) {
    throw new Error("Insufficient balance");
  }

  wallet.balance -= amount;
  await wallet.save({ session: session || undefined });

  const txData = {
    walletId,
    type: "DEBIT",
    amount,
    referenceId,
    description
  };

  if (session) {
    await Transaction.create([txData], { session });
  } else {
    await Transaction.create(txData);
  }
}


export async function walletToWalletTransfer({
  fromWalletId,
  toWalletId,
  amount
}) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const transfer = await Transfer.create([{
      fromWallet: fromWalletId,
      toWallet: toWalletId,
      amount,
      status: "PENDING"
    }], { session });

    await debitWallet({
      walletId: fromWalletId,
      amount,
      referenceId: transfer[0]._id,
      description: "Wallet transfer"
    }, session);

    await creditWallet({
      walletId: toWalletId,
      amount,
      referenceId: transfer[0]._id,
      description: "Wallet transfer"
    }, session);

    transfer[0].status = "SUCCESS";
    await transfer[0].save({ session });

    await session.commitTransaction();
    session.endSession();

    return transfer[0];

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
}
