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

const blockedFixedQueue = new BlockedFixedQueue(10);
for (let j = 0; j < 10; j++) {
    blockedFixedQueue.enqueueBlocked(signal => {
        console.log("queue", j);
        signal();
    }).ifBlocked((requestEnqueue, giveUp) => {
        requestEnqueue("once");
    }).result(result => {
        console.log(result);
    });
}

blockedFixedQueue.run();
