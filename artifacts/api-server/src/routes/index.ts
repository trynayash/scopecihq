import { Router, type IRouter } from "express";
import healthRouter from "./health";
import waitlistRouter from "./waitlist";
import eventsRouter from "./events";
import adminRouter from "./admin";
import githubRouter from "./github";

const router: IRouter = Router();

router.use(healthRouter);
router.use(waitlistRouter);
router.use(eventsRouter);
router.use(adminRouter);
router.use(githubRouter);

export default router;
