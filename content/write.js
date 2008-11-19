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

// Since we're an overlay, we assume the main XUL document has defined these.
//const Cc = Components.classes;
//const Ci = Components.interfaces;
//const Cr = Components.results;
//const Cu = Components.utils;

// modules that come with Firefox

// modules that are generic

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/service.js");

/**
 * The controller for the write message form.
 */
let WriteForm = {
  get _writeTextbox() {
    delete this._writeTextbox;
    return this._writeTextbox = document.getElementById("writeTextbox");
  },

  get _writeCounter() {
    delete this._writeCounter;
    return this._writeCounter = document.getElementById("writeCounter");
  },

  get _sendButton() {
    delete this._sendButton;
    return this._sendButton = document.getElementById("sendButton");
  },

  get _stringBundle() {
dump('document.getElementById("snowlWriteBundle"): ' + document.getElementById("snowlWriteBundle") + "\n");
    delete this._stringBundle;
    return this._stringBundle = document.getElementById("snowlWriteBundle");
  },

  // FIXME: if there is more than one target, let the user choose which one to use.
  _target: null,

  init: function() {
    this._target = SnowlService.targets[0];

    // Set the initial state of the length counter and send button.
    this.onInputMessage();
  },

  onInputMessage: function() {
    // Update the counter to reflect how many characters the user can still type.
    this._writeCounter.value =
      this._target.maxMessageLength - this._writeTextbox.value.length;

    // If the user has typed more than they can send, disable the Send button.
    this._sendButton.disabled =
      (this._writeTextbox.value.length > this._target.maxMessageLength);
  },

  onSendMessage: function() {
    this._sendButton.setAttribute("state", "sending");
    this._sendButton.label = this._stringBundle.getString("sendButton.label.sending");
    this._sendButton.disabled = true;
    this._writeTextbox.disabled = true;

    let content = this._writeTextbox.value;
    let callback = function() { WriteForm.onMessageSent() };
    // FIXME: pass an error callback and display a message to users on error.
    this._target.send(content, callback);
  },

  onMessageSent: function() {
    this._sendButton.setAttribute("state", "sent");
    this._sendButton.label = this._stringBundle.getString("sendButton.label.sent");

    window.setTimeout(function() { WriteForm.reset() }, 5000);
  },

  reset: function() {
    this._sendButton.removeAttribute("state");
    this._sendButton.label = this._stringBundle.getString("sendButton.label");
    this._sendButton.disabled = false;
    this._writeTextbox.disabled = false;
    this._writeTextbox.value = "";
    this._target = null;

    // Let the view know the message was sent so it can do any necessary cleanup.
    SnowlMessageView.onMessageSent();
  }

};
