// SINGLE=1 builds: the head worker inlined as a blob, so the one-file page works from file://.
import HeadWorker from './headWorker.js?worker&inline';

export const createHeadWorker = () => new HeadWorker();
