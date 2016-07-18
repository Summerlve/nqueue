"use strict";

const EventEmitter = require('events');

class Task {

    constructor(fn, next = null) {
        this._fn = fn;
        this._next = next;
        this._finished = false;
    }

    set next(next) {
        this._next = next;
    }

    get next() {
        return this._next;
    }

    get fn() {
        return this._fn;
    }

    done() {
        this._finished = true;
    }

    isDone() {
        return this._finished === true;
    }

}

class TaskQueue {

    constructor() {
        if (new.target === TaskQueue) throw new Error("TaskQueue can not be instanced");

        this._N = 0;
        this._first = null;
        this._last = null;
        this._running = false;
        this._curRunningTask = null;
        this._EnqueueListener = new EventEmitter();
        this._taskExecListener = new EventEmitter();
    }

    enqueue(fn) {
        this.needFn(fn);

        const task = new Task(fn);

        if (this.isEmpty())
        {
            this._first = task;
            this._last = task;
            this._N ++;
            this._EnqueueListener.emit("enqueue");
            return true;
        }

        this._last.next = task;
        this._last = task;
        this._N ++;
        this._EnqueueListener.emit("enqueue");
        return true;
    }

    dequeue() {
        if (this.isEmpty())
        {
            return null;
        }

        if (this.size() === 1)
        {
            const first = this._first;
            this._first = null;
            this._last = null;
            this._N --;
            return first;
        }

        const first = this._first;
        this._first = this._first.next;
        this._N --;
        return first;
    }

    run() {
        this._running = true;

        // listening to cur task done, then exec next task
        this._taskExecListener.on("done", _ => {
            this.execNextTask();
        });

        // begin to exec tasks
        this.execNextTask();
    }

    stop() {
        this._running = false;
        this._taskExecListener.removeAllListeners("done");
    }

    execNextTask() {
        if (!this.isRunning()) return ;

        if (this.isEmpty())
        {
            return this._EnqueueListener.once("enqueue", _ => {
                this.execNextTask();
            });
        }

        const task = this.dequeue();
        this._curRunningTask = task;

        const signal = _ => {
            setImmediate(_ => {
                this._curRunningTask.done();
                this._curRunningTask = null;
                this._taskExecListener.emit("done");
            });
        };

        process.nextTick(_ => task.fn(signal));
    }

    isEmpty() {
        return this._N === 0;
    }

    isRunning() {
        return this._running === true;
    }

    size() {
        return this._N;
    }

    needFn(fn) {
        if (typeof fn !== "function")
        {
            throw new TypeError("arg must be a function");
        }
    }

}

class FixedQueue extends TaskQueue {

    constructor(fixedSize) {
        super();
        this._fixedSize = fixedSize;
    }

    enqueue(fn) {
        this.needFn(fn);

        if (this.isFull())
        {
            return false;
        }
        else
        {
            return super.enqueue(fn);
        }
    }

    isFull() {
        return this._N === this._fixedSize;
    }

}

class WaitArea extends Array {

    constructor() {
        super();
    }

    random() {
        const n = this.length;
        return Math.floor(Math.random() * n);
    }

    isEmpty() {
        return this.length === 0;
    }

}

class WaitedFixedQueue extends FixedQueue{

    constructor(fixedSize) {
        super(fixedSize);
        this._waitArea = new WaitArea();
    }

    enqueue(fn) {
        this.needFn(fn);

        if (this.isFull())
        {
            this._waitArea.push(fn);
            return false;
        }

        return super.enqueue(fn);
    }

    dequeue() {
        if (this.isEmpty())
        {
            return null;
        }

        if (this.size() === 1)
        {
            const first = this._first;
            this._first = null;
            this._last = null;
            this._N --;
            if (!this._waitArea.isEmpty())  {
                process.nextTick(_ => {
                    const fn = this._waitArea.shift();
                    this.enqueue(fn);
                });
            }
            return first;
        }

        const first = this._first;
        this._first = this._first.next;
        this._N --;
        if (!this._waitArea.isEmpty()) {
            process.nextTick(_ => {
                const fn = this._waitArea.shift();
                this.enqueue(fn);
            });
        }
        return first;
    }

    isFull() {
        return this._N === this._fixedSize;
    }

}

class MaybeBlockedTask {

    constructor(queue, fn, isBlocked) {
        this._queue = queue;
        this._fn = fn;
        this._listener = new EventEmitter();
        this._ifBlockedCb = null;
        this._ifBlockedCbExeced = false;
        this._enqueueSucceedCb = null;
        this._enqueueFailedCb = null;
        this._onceRequest = false;
        this._foreverRequest = false;
        this._giveUpRequest = false;
        this._isBlocked = isBlocked;

        // listening to dequeue event
        this._listener.on("dequeue", _ => this.notifyDequeue());
    }

    get listener() {
        return this._listener;
    }

    isBlocked() {
        return this._isBlocked === true;
    }

    isIfBlockedCbExeced() {
        return this._ifBlockedCbExeced === true;
    }

    ifBlocked(ifBlockedCb) {
        if (!this.isBlocked()) return this;

        this._ifBlockedCb = ifBlockedCb;
        process.nextTick(_ => {
            this._ifBlockedCbExeced = true;
            this._ifBlockedCb(this.requestEnqueue.bind(this), this.giveUp.bind(this));
        });
        return this;
    }

    requestEnqueue(option) {
        if (option === "once")
        {
            this._onceRequest = true;
        }
        else if (option === "forever")
        {
            this._foreverRequest = true;
        }
    }

    giveUp() {
        this._giveUpRequest = true;
    }

    enqueueSucceed(cb) {
        this._enqueueSucceedCb = cb;
        if (!this.isBlocked()) 
        {
           process.nextTick(_ => { 
               this._enqueueSucceedCb();
           });
        }
        return this;
    }

    enqueueFailed(cb) {
        this._enqueueFailedCb = cb;
        return this;
    }

    notifyDequeue() {
        if (this._giveUpRequest === true) return ;

        if (!this.isIfBlockedCbExeced()) 
        {
            process.nextTick(_ => {
                this._ifBlockedCb(this.requestEnqueue.bind(this), this.giveUp.bind(this));
                
                process.nextTick(_ => {
                    this.notifyDequeue();
                });
            });
        }

        if (this._onceRequest === true)
        {
           process.nextTick(_ => {
                const result = this._queue.enqueueOnce(this._fn);

                if (result === true) 
                {
                    this._enqueueSucceedCb();
                }
                else 
                {
                    this._enqueueFailedCb();
                }
            });
        }
        else if (this._foreverRequest === true)
        {
             process.nextTick(_ => {
                const result = this._queue.enqueue(this._fn);

                if (result === true) 
                {
                    this._enqueueSucceedCb();
                }
                else
                {
                    this._queue._blockedListenerCollection.push(this._listener);
                    this._enqueueFailedCb();
                }
             });
        }
    }

}

class BlockedFixedQueue extends FixedQueue {

    constructor(fixedSize) {
        super(fixedSize);
        this._blockedListenerCollection = [];
    }

    enqueueBlocked(fn) {
        this.needFn(fn);

        if (this.isFull())
        {
            const blocked = new MaybeBlockedTask(this, fn, true);
            this._blockedListenerCollection.push(blocked.listener);

            return blocked;
        }
        else
        {
            super.enqueue(fn);
            return new MaybeBlockedTask(this, fn, false);
        }
    }

    enqueueOnce(fn) {
        return super.enqueue(fn);
    }

    dequeue() {
        const blockedListener = this._blockedListenerCollection.shift();
        if (blockedListener) blockedListener.emit("dequeue");
        return super.dequeue();
    }

}

module.exports.TaskQueue = TaskQueue;
module.exports.WaitedFixedQueue = WaitedFixedQueue;
module.exports.FixedQueue = FixedQueue;
module.exports.BlockedFixedQueue = BlockedFixedQueue;
