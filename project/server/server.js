const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");
require("dotenv").config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Serve Frontend
app.use(express.static(path.join(__dirname, "../client")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/index.html"));
});

// Gemini AI
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// MongoDB
mongoose.connect(
  process.env.MONGO_URI || "mongodb://localhost:27017/expenseDB"
)
.then(() => console.log("✅ MongoDB Connected"))
.catch(err => console.log(err));

/* ===========================
   USER SCHEMA
=========================== */

const UserSchema = new mongoose.Schema({
  email: {
    type: String,
    unique: true,
    required: true
  },
  password: {
    type: String,
    required: true
  }
});

const User = mongoose.model("User", UserSchema);

/* ===========================
   EXPENSE SCHEMA
=========================== */

const ExpenseSchema = new mongoose.Schema({

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  title: {
    type: String,
    required: true
  },

  amount: {
    type: Number,
    required: true
  },

  category: {
    type: String,
    default: "Other"
  },

  merchant: {
    type: String,
    default: "General"
  },

  type: {
    type: String,
    enum: ["expense", "income"],
    default: "expense"
  },

  date: {
    type: Date,
    default: Date.now
  }

});

const Expense = mongoose.model("Expense", ExpenseSchema);

/* ===========================
   AUTH MIDDLEWARE
=========================== */

function auth(req, res, next) {

  const token = req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({
      error: "Access Denied"
    });
  }

  try {

    const verified = jwt.verify(
      token,
      process.env.JWT_SECRET || "super_secret_key_123"
    );

    req.user = verified;

    next();

  } catch (err) {

    res.status(400).json({
      error: "Invalid Token"
    });

  }

}

/* ===========================
   REGISTER
=========================== */

app.post("/api/auth/register", async (req, res) => {
  try {

    const { email, password } = req.body;

    const existing = await User.findOne({ email });

    if (existing) {
      return res.status(400).json({
        error: "Email already exists"
      });
    }

    const hashed = await bcrypt.hash(password, 10);

    const user = await User.create({
      email,
      password: hashed
    });

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET || "super_secret_key_123"
    );

    res.status(201).json({
      token,
      email
    });

  } catch (err) {

    console.log(err);

    res.status(500).json({
      error: "Registration failed"
    });

  }
});

/* ===========================
   LOGIN
=========================== */

app.post("/api/auth/login", async (req, res) => {

  try {

    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user)
      return res.status(400).json({ error: "Invalid Email" });

    const ok = await bcrypt.compare(password, user.password);

    if (!ok)
      return res.status(400).json({ error: "Invalid Password" });

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET || "super_secret_key_123"
    );

    res.json({
      token,
      email
    });

  } catch (err) {

    res.status(500).json({
      error: "Login Failed"
    });

  }

});

/* ===========================
   ADD EXPENSE
=========================== */

app.post("/api/expenses", auth, async (req, res) => {

  try {

    const {
      title,
      amount,
      category,
      merchant,
      type
    } = req.body;

    const expense = await Expense.create({

      userId: req.user.id,

      title,

      amount,

      category,

      merchant,

      type: type || "expense"

    });

    res.status(201).json(expense);

  } catch (err) {

    console.log(err);

    res.status(500).json({
      error: "Unable to save expense"
    });

  }

});

/* ===========================
   GET EXPENSES
=========================== */

app.get("/api/expenses", auth, async (req, res) => {

  const expenses = await Expense.find({
    userId: req.user.id
  }).sort({
    date: -1
  });

  res.json(expenses);

});

/* ===========================
   UPDATE EXPENSE
=========================== */

app.put("/api/expenses/:id", auth, async (req, res) => {

  try {

    const updated = await Expense.findOneAndUpdate(

      {
        _id: req.params.id,
        userId: req.user.id
      },

      req.body,

      {
        new: true
      }

    );

    res.json(updated);

  } catch (err) {

    res.status(500).json({
      error: "Update Failed"
    });

  }

});

/* ===========================
   DELETE EXPENSE
=========================== */

app.delete("/api/expenses/:id", auth, async (req, res) => {

  await Expense.findOneAndDelete({

    _id: req.params.id,

    userId: req.user.id

  });

  res.json({

    success: true

  });

});

/* ===========================
   AI RECEIPT PARSER
=========================== */

app.post("/api/expenses/ai", auth, async (req, res) => {

  try {

    const { rawText } = req.body;

    const prompt = `
Extract title, amount, category and merchant.
Return ONLY JSON.

Text:
${rawText}
`;

    const response = await ai.models.generateContent({

      model: "gemini-2.5-flash",

      contents: prompt

    });

    const data = JSON.parse(response.text.trim());

    const expense = await Expense.create({

      userId: req.user.id,

      title: data.title,

      amount: data.amount,

      category: data.category,

      merchant: data.merchant,

      type: "expense"

    });

    res.status(201).json(expense);

  } catch (err) {

    console.log(err);

    res.status(500).json({

      error: "AI Parsing Failed"

    });

  }

});

/* ===========================
   SERVER
=========================== */

const PORT = process.env.PORT || 9000;

app.listen(PORT, () => {

  console.log(`🚀 Server running on http://localhost:${PORT}`);

});