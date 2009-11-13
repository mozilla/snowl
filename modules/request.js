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
 * The Original Code is Snowl.
 *
 * The Initial Developer of the Original Code is Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2008
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
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

let EXPORTED_SYMBOLS = ["Request", "Callback"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

// modules that are generic
// FIXME: avoid dependency on host extension.
Cu.import("resource://snowl/modules/log4moz.js");

// modules that are built into Firefox
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

function Request(args) {
  for (let name in args)
    this[name] = args[name];

  this._request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].
                  createInstance();

  this._request.QueryInterface(Ci.nsIDOMEventTarget);

  if (this.loadCallback) {
    this._log.trace("setting load callback: " + this.loadCallback);
    this._request.addEventListener("load", this.loadCallback, false);
  }

  if (this.errorCallback) {
    this._log.trace("setting error callback: " + this.errorCallback);
    this._request.addEventListener("error", this.errorCallback, false);
  }

  this._request.QueryInterface(Ci.nsIXMLHttpRequest);

  // FIXME: override the MIME type to a type the consumer specifies.
  if (this.overrideMimeType) {
    this._log.trace("overriding mime type\n");
    this._request.overrideMimeType("text/plain");
  }

  let url = this.url instanceof Ci.nsIURI ? this.url.spec : this.url;
  this._log.trace("opening request with method: " + this.method + "; url: " + url + "; async: " + this.async);
  this._request.open(this.method,
                     url,
                     this.async);

  if (this.requestHeaders) {
    for (let [name, value] in Iterator(this.requestHeaders)) {
      this._log.trace("setting request header: " + name + " = " + value);
      this._request.setRequestHeader(name, value);
    }
  }

  // Register a listener for notification callbacks so we handle authentication.
  if (this.notificationCallbacks) {
    this._log.trace("setting notification callbacks: " + this.notificationCallbacks);
    this._request.channel.notificationCallbacks = this.notificationCallbacks;
  }

  this._log.trace("sending request with body: " + this.body);
  // Cleanly handle NS_ERROR_FAILURE exceptions, thrown if the domain name
  // cannot be resolved.
  try {
    this._request.send(this.body);
  }
  catch (ex) {
    this.error = true;
    this.throwText = ex;
  }

  return;
}

Request.prototype = {
  method: "GET",
  async: false,
  body: null,
  requestHeaders: null,
  error: false,
  throwStatus : "connection:error",
  throwText : "",

  get _log() {
    let log = Log4Moz.repository.getLogger("Request");
    this.__defineGetter__("_log", function() log);
    return this._log;
  },

  get status() {
    return this.error ? this.throwStatus : this._request.status;
  },

  // Sometimes getting statusText throws.  When it does, we return the exception
  // instead, which seems more useful.
  get statusText() {
    try {
      return this.error ? this.throwText : this._request.statusText;
    }
    catch(ex) {
      return ex;
    }
  },

  get responseText() this._request.responseText,
  get channel() this._request.channel
};

function Callback(func, thisObject) {
  this.func = func;
  this.thisObject = thisObject;
}

Callback.prototype = {
  func:       null,
  thisObject: null,

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIDOMEventListener,
                                         Ci.nsISupportsWeakReference]),

  //**************************************************************************//
  // nsIDOMEventListener

  handleEvent: function(event) {
    if (this.thisObject)
      this.func.call(this.thisObject, event);
    else
      this.func(event);
  }

};
