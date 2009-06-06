/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Bookmarks Sync.
 *
 * The Initial Developer of the Original Code is Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2007
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *  Dan Mills <thunder@mozilla.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

const EXPORTED_SYMBOLS = ['Async'];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

let Utils = {
  // Works on frames or exceptions, munges file:// URIs to shorten the paths
  // FIXME: filename munging is sort of hackish, might be confusing if
  // there are multiple extensions with similar filenames
  formatFrame: function Utils_formatFrame(frame) {
    let tmp = "<file:unknown>";

    if (frame.filename)
      tmp = frame.filename.replace(/^file:\/\/.*\/([^\/]+.js)$/, "module:$1");
    else if (frame.fileName)
      tmp = frame.fileName.replace(/^file:\/\/.*\/([^\/]+.js)$/, "module:$1");

    // skip async.js frames
    if (tmp == "module:async.js")
      return null;

    if (frame.lineNumber)
      tmp += ":" + frame.lineNumber;
    if (frame.name)
      tmp += " :: " + frame.name;

    return tmp;
  },

  exceptionStr: function Weave_exceptionStr(e) {
    let message = e.message ? e.message : e;
    let location = "";

    if (e.location) // Wrapped nsIException.
      location = e.location;
    else if (e.fileName && e.lineNumber) // Standard JS exception
      location = Utils.formatFrame(e);

    if (location)
      location = " (" + location + ")";
    return message + location;
  },

  stackTraceFromFrame: function Weave_stackTraceFromFrame(frame, formatter) {
    if (!formatter)
      formatter = function defaultFormatter(frame) { return frame; };

    let output = "";

    while (frame) {
      let str = formatter(frame);
      if (str)
        output += str + "\n";
      frame = frame.caller;
    }

    return output;
  },

  stackTrace: function Weave_stackTrace(e, formatter) {
    if (e.asyncStack) // AsyncException
      return "Original exception: " + Utils.exceptionStr(e.originalException) + "\n" +
             "Async stack trace:\n" + e.asyncStack;
    else if (e.location) // Wrapped nsIException
      return "Stack trace:\n" + this.stackTraceFromFrame(e.location, formatter);
    else if (e.stack) // Standard JS exception
      return "JS Stack trace:\n" + e.stack;
    else
      return "No traceback available";
  },

  // Returns a timer that is scheduled to call the given callback as
  // soon as possible.
  makeTimerForCall: function makeTimerForCall(cb) {
    let timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    timer.initWithCallback(new Utils.EventListener(cb),
                           0, timer.TYPE_ONE_SHOT);
    return timer;
  },

  /*
   * Event listener object
   * Used to handle XMLHttpRequest and nsITimer callbacks
   */

  EventListener: function Weave_EventListener(handler, eventName) {
    this._handler = handler;
    this._eventName = eventName;
    this._log = Async.Log4Moz.repository.getLogger("Async.EventHandler");
    this._log.level = Async.logLevel;
  }
};

Utils.EventListener.prototype = {
  QueryInterface: XPCOMUtils.generateQI([Ci.nsITimerCallback, Ci.nsISupports]),

  // DOM event listener
  handleEvent: function EL_handleEvent(event) {
    this._log.trace("Handling event " + this._eventName);
    this._handler(event);
  },

  // nsITimerCallback
  notify: function EL_notify(timer) {
    //this._log.trace("Timer fired");
    this._handler(timer);
  }
};

/*
 * Asynchronous generator helpers
 */

// Simple class to help us keep track of "namable" objects: that is,
// any object with a string property called "name".
function NamableTracker() {
  this.__length = 0;
  this.__dict = {};
}

NamableTracker.prototype = {
  get length() { return this.__length; },
  add: function GD_add(item) {
    this.__dict[item.name] = item;
    this.__length++;
  },
  remove: function GD_remove(item) {
    delete this.__dict[item.name];
    this.__length--;
  },
  __iterator__: function GD_iterator() {
    for (name in this.__dict)
      yield name;
  }
}

let gCurrentId = 0;
let gCurrentCbId = 0;
let gOutstandingGenerators = new NamableTracker();

// The AsyncException class represents an exception that's been thrown
// by an asynchronous coroutine-based function.  For the most part, it
// behaves just like the "real" exception it wraps, only it adds some
// embellishments that provide information about what other
// asynchronous coroutine-based functions our current one was called
// from.
function AsyncException(asyncStack, exceptionToWrap) {
  this._originalException = exceptionToWrap;
  this._asyncStack = asyncStack;

  // Here we'll have our exception instance's prototype be dynamically
  // generated; this ultimately allows us to dynamically "subclass"
  // the exception we're wrapping at runtime.
  this.__proto__ = {
    __proto__: this._originalException,

    get asyncStack() this._asyncStack,
    get originalException() this._originalException,

    addAsyncFrame: function AsyncException_addAsyncFrame(frame) {
      this._asyncStack += ((this._asyncStack? "\n" : "") +
                           Utils.formatFrame(frame));
    },

    toString: function AsyncException_toString() {
      return this._originalException.toString();
    }
  };
}

function Generator(thisArg, method, onComplete, args) {
  this._outstandingCbs = 0;
  this._log = Async.Log4Moz.repository.getLogger("Async.Generator");
  this._log.level = Async.logLevel;
  this._thisArg = thisArg;
  this._method = method;
  this._id = gCurrentId++;
  this.onComplete = onComplete;
  this._args = args;
  this._stackAtLastCallbackGen = null;

  gOutstandingGenerators.add(this);

  this._initFrame = skipAsyncFrames(Components.stack.caller);
}
Generator.prototype = {
  get name() { return this._method.name + "-" + this._id; },
  get generator() { return this._generator; },

  get cb() {
    let caller = Components.stack.caller;
    let cbId = gCurrentCbId++;
    this._outstandingCbs++;
    this._stackAtLastCallbackGen = caller;
    this._log.trace(this.name + ": cb-" + cbId + " generated at:\n" +
                    Utils.formatFrame(caller));
    let self = this;
    let cb = function(data) {
      self._log.trace(self.name + ": cb-" + cbId + " called.");
      self._cont(data);
    };
    cb.parentGenerator = this;
    return cb;
  },
  get listener() { return new Utils.EventListener(this.cb); },

  get _thisArg() { return this.__thisArg; },
  set _thisArg(value) {
    if (typeof value != "object")
      throw "Generator: expected type 'object', got type '" + typeof(value) + "'";
    this.__thisArg = value;
  },

  get _method() { return this.__method; },
  set _method(value) {
    if (typeof value != "function")
      throw "Generator: expected type 'function', got type '" + typeof(value) + "'";
    this.__method = value;
  },

  get onComplete() {
    if (this._onComplete)
      return this._onComplete;
    return function() {
      //this._log.trace("Generator " + this.name + " has no onComplete");
    };
  },
  set onComplete(value) {
    if (value && typeof value != "function")
      throw "Generator: expected type 'function', got type '" + typeof(value) + "'";
    this._onComplete = value;
  },

  get asyncStack() {
    let cbGenText = "";
    if (this._stackAtLastCallbackGen)
      cbGenText = "Last callback created at " +
                  Utils.formatFrame(this._stackAtLastCallbackGen);
    return Utils.stackTraceFromFrame(this._initFrame, Utils.formatFrame) + cbGenText;
  },

  _handleException: function AsyncGen__handleException(e) {
    if (e instanceof StopIteration) {
      this._log.trace(this.name + ": End of coroutine reached.");
      // skip to calling done()

    } else if (this.onComplete && this.onComplete.parentGenerator &&
               this.onComplete.parentGenerator instanceof Generator) {
      this._log.trace("[" + this.name + "] Saving exception and stack trace");
      this._log.trace("Exception: " + Utils.exceptionStr(e));

        if (e instanceof AsyncException) {
          // FIXME: attempt to skip repeated frames, which can happen if the
          // child generator never yielded.  Would break for valid repeats (recursion)
          if (e.asyncStack.indexOf(Utils.formatFrame(this._initFrame)) == -1)
            e.addAsyncFrame(this._initFrame);
        } else {
          e = new AsyncException(this.asyncStack, e);
        }

      this._exception = e;

    } else if (e.message && e.message == 'Cannot acquire lock (internal lock)') {
      this._log.warn("Exception: " + Utils.exceptionStr(e));
    } else {
      this._log.error("Exception: " + Utils.exceptionStr(e));
      this._log.debug("Async stack trace:\n" + Utils.stackTrace(e, Utils.formatFrame));
    }

    // continue execution of caller.
    // in the case of StopIteration we could return an error right
    // away, but instead it's easiest/best to let the caller handle
    // the error after a yield / in a callback.
    if (!this._timer) {
      this._log.trace("[" + this.name + "] running done() from _handleException()");
      this.done();
    }
  },

  _detectDeadlock: function AsyncGen__detectDeadlock() {
    if (this._outstandingCbs == 0)
      this._log.warn("Async method '" + this.name +
                     "' may have yielded without an outstanding callback.");
  },

  run: function AsyncGen_run() {
    this._continued = false;
    try {
      this._generator = this._method.apply(this._thisArg, this._args);
      this.generator.next(); // must initialize before sending
      this.generator.send(this);
      this._detectDeadlock();
    } catch (e) {
      if (!(e instanceof StopIteration) || !this._timer)
        this._handleException(e);
    }
  },

  _cont: function AsyncGen__cont(data) {
    this._outstandingCbs--;
    this._log.trace(this.name + ": resuming coroutine.");
    this._continued = true;
    try {
      this.generator.send(data);
      this._detectDeadlock();
    } catch (e) {
      if (!(e instanceof StopIteration) || !this._timer)
        this._handleException(e);
    }
  },

  _throw: function AsyncGen__throw(exception) {
    this._outstandingCbs--;
    try { this.generator.throw(exception); }
    catch (e) {
      if (!(e instanceof StopIteration) || !this._timer)
        this._handleException(e);
    }
  },

  // async generators can't simply call a callback with the return
  // value, since that would cause the calling function to end up
  // running (after the yield) from inside the generator.  Instead,
  // generators can call this method which sets up a timer to call the
  // callback from a timer (and cleans up the timer to avoid leaks).
  // It also closes generators after the timeout, to keep things
  // clean.
  done: function AsyncGen_done(retval) {
    if (this._timer) // the generator/_handleException called self.done() twice
      return;
    let self = this;
    let cb = function() { self._done(retval); };
    this._log.trace(this.name + ": done() called.");
    if (!this._exception && this._outstandingCbs > 0)
      this._log.warn("Async method '" + this.name +
                     "' may have outstanding callbacks.");
    this._timer = Utils.makeTimerForCall(cb);
  },

  _done: function AsyncGen__done(retval) {
    if (!this._generator) {
      this._log.error("Async method '" + this.name + "' is missing a 'yield' call " +
                      "(or called done() after being finalized)");
      this._log.trace("Initial async stack trace:\n" + this.asyncStack);
    } else {
      this._generator.close();
    }
    this._generator = null;
    this._timer = null;

    if (this._exception) {
      this._log.trace("[" + this.name + "] Propagating exception to parent generator");
      this.onComplete.parentGenerator._throw(this._exception);
    } else {
      try {
        this._log.trace("[" + this.name + "] Running onComplete()");
        this.onComplete(retval);
      } catch (e) {
        this._log.error("Exception caught from onComplete handler of " +
                        this.name + " generator");
        this._log.error("Exception: " + Utils.exceptionStr(e));
        this._log.trace("Current stack trace:\n" +
                        Utils.stackTrace(e, Utils.formatFrame));
        this._log.trace("Initial async stack trace:\n" + this.asyncStack);
      }
    }
    gOutstandingGenerators.remove(this);
  }
};

function skipAsyncFrames(frame) {
  while (frame.name && frame.name.match(/^Async(Gen|)_/))
    frame = frame.caller;
  return frame;
}

let Async = {
  // The Log4Moz object that this module uses for logging.
  // The consumer that initially imports this module must set this value.
  Log4Moz: null,

  // The level at which this module logs messages.  This value is the same
  // for all consumers using this module, since the Async object is a singleton.
  // Consumers that want this to be different should set it after initially
  // importing the module.
  logLevel: "Warn",

  get outstandingGenerators() { return gOutstandingGenerators; },

  // Use:
  // let gen = Async.run(this, this.fooGen, ...);
  // let ret = yield;
  //
  // where fooGen is a generator function, and gen is a Generator instance
  // ret is whatever the generator 'returns' via Generator.done().

  run: function Async_run(thisArg, method, onComplete /* , arg1, arg2, ... */) {
    let args = Array.prototype.slice.call(arguments, 3);
    let gen = new Generator(thisArg, method, onComplete, args);
    gen.run();
    return gen;
  },

  // Syntactic sugar for run().  Meant to be used like this in code
  // that imports this file:
  //
  // Function.prototype.async = Async.sugar;
  //
  // So that you can do:
  //
  // let gen = fooGen.async(...);
  // let ret = yield;
  //
  // Note that 'this' refers to the method being called, not the
  // Async object.

  sugar: function Async_sugar(thisArg, onComplete  /* , arg1, arg2, ... */) {
    let args = Array.prototype.slice.call(arguments, 1);
    args.unshift(thisArg, this);
    Async.run.apply(Async, args);
  }
};
