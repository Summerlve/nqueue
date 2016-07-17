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
        if (typeof fn !== "function")
        {
            throw new TypeError("arg must be a function");
        }

        if (this.isFull())
        {
            return ;
        }

        const task = new Task(fn);

        if (this.isEmpty())
        {
            this._first = task;
            this._last = task;
            this._N ++;
            this._EnqueueListener.emit("enqueue");
            return ;
        }

        this._last.next = task;
        this._last = task;
        this._N ++;
        this._EnqueueListener.emit("enqueue");
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

class WaitedFixedQueue extends TaskQueue{

    constructor(fixedSize) {
        super();
        this._fixedSize = fixedSize;
        this._waitArea = new WaitArea();
    }

    enqueue(fn) {
        if (typeof fn !== "function")
        {
            throw new TypeError("arg must be a function");
        }

        if (this.isFull())
        {
            return this._waitArea.push(fn);
        }

        const task = new Task(fn);

        if (this.isEmpty())
        {
            this._first = task;
            this._last = task;
            this._N ++;
            this._EnqueueListener.emit("enqueue");
            return ;
        }

        this._last.next = task;
        this._last = task;
        this._N ++;
        this._EnqueueListener.emit("enqueue");
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


class FixedQueue extends TaskQueue {

    constructor(fixedSize) {
        super();
        this._fixedSize = fixedSize;
    }

    enqueue(fn) {
        if (this.isFull())
        {
            return false;
        }
        else
        {
            super.enqueue(fn);
            return true;
        }
    }

    isFull() {
        return this._N === this._fixedSize;
    }

}

class MaybeBlocked {

    constructor(queue, fn, isBlocked) {
        this._queue = queue;
        this._fn = fn;
        this._listener = new EventEmitter();
        this._ifBlockedCb = null;
        this._enqueueSucceedCb = null;
        this._enqueueFailedCb = null;
        this._onceRequest = false;
        this._foreverRequest = false;
        this._isBlocked = isBlocked;
        this._interval = 0;

        this._listener.on("dequeue", _ => this.notifyDequeue());
    }

    get listener() {
        return this._listener;
    }

    isBlocked() {
        return this._isBlocked === true;
    }

    ifBlocked(ifBlockedCb) {
        this._ifBlockedCb = ifBlockedCb;
        if (this.isBlocked()) process.nextTick(_ => this._ifBlockedCb(this.requestEnqueue.bind(this), this.giveUp.bind(this)));
        return this;
    }

    requestEnqueue(option, interval) {
        this._interval = interval;

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
        this._queue._blockedSet.delete(this);
    }

    succeed(cb) {
        this._enqueueSucceedCb = cb;
        if (!this.isBlocked()) 
        {
           process.nextTick(_ => { 
               this._enqueueSucceedCb();
           });
        }
        return this;
    }

    failed(cb) {
        this._enqueueFailedCb = cb;
        return this;
    }

    notifyDequeue() {
        if (this._onceRequest === true)
        {
           setTimeout(_ => {
                const result = this._queue.enqueueOnce(this._fn);
                this._queue._blockedListenerSet.delete(this.listener);

                if (result === true) 
                {
                    this._enqueueSucceedCb();
                }
                else 
                {
                    this._enqueueFailedCb();
                }
            }, this._interval);
        }
        else if (this._foreverRequest === true)
        {
             setTimeout(_ => {
                const result = this._queue.enqueue(this._fn);

                if (result === true) 
                {
                    this._queue._blockedListenerSet.delete(this.listener);
                    this._enqueueSucceedCb();
                }
                else
                {
                    this._enqueueFailedCb();
                }
             }, this._interval);
        }
    }

}

class BlockedFixedQueue extends FixedQueue {

    constructor(fixedSize) {
        super(fixedSize);
        this._blockedListenerSet = new Set();
    }

    enqueueBlocked(fn) {
        if (this.isFull())
        {
            const blocked = new MaybeBlocked(this, fn, true);
            this._blockedListenerSet.add(blocked.listener);

            return blocked;
        }
        else
        {
            super.enqueue(fn);
            return new MaybeBlocked(null, null, false);
        }
    }

    dequeue() {
        this._blockedListenerSet.forEach(_ => _.emit("dequeue"));
        return super.dequeue();
    }

    enqueueOnce(fn) {
        return super.enqueue(fn);
    }

}

module.exports.TaskQueue = TaskQueue;
module.exports.WaitedFixedQueue = WaitedFixedQueue;
module.exports.FixedQueue = FixedQueue;
module.exports.BlockedFixedQueue = BlockedFixedQueue;
