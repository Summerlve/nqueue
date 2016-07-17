"use strict";

const {WaitedFixedQueue, TaskQueue, FixedQueue, BlockedFixedQueue} = require("../index.js");


// const queue = new WaitedFixedQueue(100);
//
// for (let j = 0; j < 60000; j++) {
//     queue.enqueue(signal => {
//         console.log("queue", j);
//         signal();
//     });
// }
//
//
// queue.run();
//
// setTimeout(_ => {
//     console.log("stop");
//     queue.stop();
// }, 1000);
//
// setTimeout(_ => {
//     console.log(queue._curRunningTask);
// }, 4000);

const blockedFixedQueue = new BlockedFixedQueue(100);
for (let j = 0; j < 20000; j++) {
    blockedFixedQueue.enqueueBlocked(signal => {
        console.log("queue", j, "queue size:", blockedFixedQueue.size());
        signal();
    }).ifBlocked((requestEnqueue, giveUp) => {
        requestEnqueue("forever");
    }).enqueueSucceed(_ => {
        // console.log("enqueue succeed");
    }).enqueueFailed(_ => {
        // console.log("enqueue failed");
    });
}

blockedFixedQueue.run();
