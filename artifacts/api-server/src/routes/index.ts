import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scrapeRouter from "./scrape";
import dataRouter from "./data";
import predictionsRouter from "./predictions";
import backtestRouter from "./backtest";
import optimizerRouter from "./optimizer";
import superhybridRouter from "./superhybrid";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scrapeRouter);
router.use("/data", dataRouter);
router.use("/predictions", predictionsRouter);
router.use("/backtest", backtestRouter);
router.use("/optimizer", optimizerRouter);
router.use("/superhybrid", superhybridRouter);

export default router;
