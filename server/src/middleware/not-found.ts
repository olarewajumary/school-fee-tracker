import type { RequestHandler } from "express";
import { notFound } from "../errors/app-error";

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(notFound(`Route ${req.method} ${req.path} not found`));
};
