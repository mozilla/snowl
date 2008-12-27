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
 * The Original Code is Observers.
 *
 * The Initial Developer of the Original Code is Daniel Aquino.
 * Portions created by the Initial Developer are Copyright (C) 2008
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Daniel Aquino <mr.danielaquino@gmail.com>
 *   Myk Melez <myk@mozilla.org>
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

let EXPORTED_SYMBOLS = ["Observers"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

/**
 * A service for adding, removing and notifying observers of notifications.
 * Wraps the nsIObserverService interface.
 *
 * @version 0.2
 */
let Observers = {
  add: function(topic, callback, thisObject) {
    if (typeof thisObject == "undefined")
      thisObject = null;

    if (typeof callback == "string") {
      if (!thisObject)
        throw "callback is a string (" + callback + ") but there is no thisObject";
      if (typeof thisObject != "object")
        throw "callback is a string (" + callback + ") but thisObject is a " + (typeof thisObject) + ", not an object";
      if (!(callback in thisObject))
        throw "callback (" + callback + ") is not in thisObject";
      if (typeof thisObject[callback] != "function")
        throw "callback (" + callback + ") in thisObject is not a function";
    }

    let observer = new Observer(callback, thisObject);

    // Index the observer to make it easier to remove.  We index by exact
    // combination of topic, callback, and (possibly null) thisObject,
    // so the caller must call our remove() method with the same values
    // in order for us to remove the observer.
    if (!(topic in Observers._observers))
      Observers._observers[topic] = {};
    if (!(callback in Observers._observers[topic]))
      Observers._observers[topic][callback] = {};
    Observers._observers[topic][callback][thisObject] = observer;

    Observers._service.addObserver(observer, topic, true);

    return observer;
  },

  remove: function(topic, callback, thisObject) {
    if (typeof thisObject == "undefined")
      thisObject = null;

    let observer;

    if (Observers._observers[topic] && Observers._observers[topic][callback])
      observer = Observers._observers[topic][callback][thisObject];

    if (observer) {
      Observers._service.removeObserver(observer, topic);
      delete this._observers[topic][callback][thisObject];
    }
  },

  notify: function(topic, subject, data) {
    subject = (typeof subject == "undefined") ? null : new Subject(subject);
       data = (typeof    data == "undefined") ? null : data;
    Observers._service.notifyObservers(subject, topic, data);
  },

  _service: Cc["@mozilla.org/observer-service;1"].
            getService(Ci.nsIObserverService),

  // Observers indexed by callback.  This lets us get the observer
  // to remove when a caller calls |remove|, passing it a callback.
  _observers: {}
};


function Observer(callback, thisObject) {
  this._callback = callback;
  this._thisObject = thisObject;
}

Observer.prototype = {
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver, Ci.nsISupportsWeakReference]),
  observe: function(subject, topic, data) {
    // Pass the wrappedJSObject for subjects that have one.  Otherwise pass
    // the subject itself.  This way we support both wrapped subjects created
    // using this module and those that are real XPCOM components.
    let unwrappedSubject = subject.wrappedJSObject || subject;

    if (typeof this._callback == "function") {
      if (this._thisObject)
        this._callback.call(this._thisObject, topic, unwrappedSubject, data);
      else
        this._callback(topic, unwrappedSubject, data);
    }
    else if (typeof this._callback == "string") {
      this._thisObject[this._callback](topic, unwrappedSubject, data);
    }
    else // typeof this._callback == "object" (nsIObserver)
      this._callback.observe(topic, unwrappedSubject, data);
  }
}


function Subject(object) {
  this.wrappedJSObject = object;
}

Subject.prototype = {
  QueryInterface: XPCOMUtils.generateQI([]),
  getHelperForLanguage: function() {},
  getInterfaces: function() {}
};
