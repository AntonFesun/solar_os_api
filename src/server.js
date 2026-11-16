import express from "express";
import cors from "cors";
import 'dotenv/config';
import {connectMongoDB} from "./db/connectToMongoDB.js";
import {logger} from "./middleware/logger.js";
import { errors } from 'celebrate';
import cookieParser from 'cookie-parser';
import {notFoundHandler} from "./middleware/notFoundHandler.js";
import {errorHandler} from "./middleware/errorHandler.js";


const app = express();
const port = process.env.PORT || 3030;

// Middleware
app.use(express.json());
app.use(cors());
app.use(cookieParser());
app.use(logger);

// Routes


// Error handlers
app.use(notFoundHandler);
app.use(errors());
app.use(errorHandler);


await connectMongoDB();
app.listen(port, () => {
  console.log('Server is running on a port: ' + port);
});
