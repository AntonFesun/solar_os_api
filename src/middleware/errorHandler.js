import { HttpError } from "http-errors";

export const errorHandler = (err, req, res, next) => {

  if(err instanceof HttpError) {
    res.status(err.status).json({ message: err.message});
    return;
  }

  const message = 'Internal server error';
  const error =
  process.env.NODE_ENV === 'production'
    ? 'Something went wrong, try again later'
    : err.message;

  res.status(500).json({
    message,
    error,
  });
};
