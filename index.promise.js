"use strict";

const EventEmitter = require("events");

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

class MaybeBlockedTask extends Task {

    constructor(fn, next, isBlocked) {
        super(fn, next);
        this._ifBlockedCb = null;
        this._resultCb = null;
        this._onceRequest = false;
        this._foreverRequest = false;
        this._isBlocked = isBlocked;
    }

    get isBlocked() {
        return this._isBlocked === true;
    }

    ifBlocked(cb) {
        this._ifBlockedCb = cb;
        return this;
    }

    result(cb) {
        this._resultCb = cb;
        return this;
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