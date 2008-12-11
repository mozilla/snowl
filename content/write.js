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
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/StringBundle.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/service.js");

/**
 * The controller for the write message form.
 */
let WriteForm = {
  //**************************************************************************//
  // Shortcuts

  get _strings() {
    delete this._strings;
    return this._strings = new StringBundle("chrome://snowl/locale/write.properties");
  },

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

  get _targetMenu() {
    delete this._targetMenu;
    return this._targetMenu = document.getElementById("targetMenu");
  },

  get _target() {
    return this._targetMenu.selectedItem ? this._targetMenu.selectedItem.target : null;
  },


  //**************************************************************************//
  // Event & Notification Handlers

  onLoad: function() {
    Observers.add(this, "snowl:sources:changed");
    this._rebuildTargetsMenu();
    this._updateFormState();
  },

  // nsIObserver
  observe: function(subject, topic, data) {
    switch (topic) {
      case "snowl:sources:changed":
        this._onSourcesChanged();
        break;
    }
  },

  _onSourcesChanged: function() {
    this._rebuildTargetsMenu();
    this._updateFormState();
  },

  onSelectTarget: function() {
    this._maybeResetSendStatus();
    this._updateFormState();
  },

  onInputMessage: function() {
    this._maybeResetSendStatus();
    this._updateFormState();
  },

  onSendMessage: function() {
    this._sendButton.setAttribute("state", "sending");
    this._sendButton.label = this._strings.get("sendButton.label.sending");
    this._sendButton.disabled = true;

    this._writeTextbox.disabled = true;
    this._targetMenu.disabled = true;

    let content = this._writeTextbox.value;
    let callback = function() { WriteForm.onMessageSent() };
    // FIXME: pass an error callback and display a message to users on error.
    this._target.send(content, callback);
  },

  onMessageSent: function() {
    this._sendButton.setAttribute("state", "sent");
    this._sendButton.label = this._strings.get("sendButton.label.sent");

    this._writeTextbox.disabled = false;
    this._targetMenu.disabled = false;

    this._writeTextbox.value = "";

    this._resetSendStatusTimeoutID =
      window.setTimeout(function() { WriteForm.resetSendStatus() }, 5000);
  },


  //**************************************************************************//
  // Everything Else

  _rebuildTargetsMenu: function() {
    // Save the ID of the selected item so we can restore the selection
    // after rebuilding the menu.
    let selectedItem = this._targetMenu.selectedItem;
    let selectedItemID = selectedItem ? selectedItem.value : null;

    this._targetMenu.removeAllItems();

    for each (let target in SnowlService.targets) {
      let targetItem = this._targetMenu.appendItem(target.name, target.id);
      targetItem.target = target;
    }

    // Select a target from the list if possible.
    if (this._targetMenu.itemCount > 0) {
      this._targetMenu.selectedIndex = 0;

      // Restore the selection if it remains in the menu after the rebuild.
      if (selectedItemID) {
        for (let i = 0; i < this._targetMenu.itemCount; i++) {
          if (this._targetMenu.getItemAtIndex(i).id == selectedItemID) {
            this._targetMenu.selectedIndex = i;
            break;
          }
        }
      }
    }
  },

  /**
   * Update the value of the "remaining characters" counter and the disabled
   * status of the Send button based on the selected target and the amount
   * of content the user has entered.
   */
  _updateFormState: function() {
    if (this._target && this._target.maxMessageLength) {
      // Update the counter to show how many more characters the user can type.
      this._writeCounter.value =
        this._target.maxMessageLength - this._writeTextbox.value.length;

      // If the user has typed more than they can send, disable the Send button.
      this._sendButton.disabled =
        (this._writeTextbox.value.length > this._target.maxMessageLength);
    }
    else if (this._target) {
      this._writeCounter.value = "";
      this._sendButton.disabled = false;
    }
    else {
      this._writeCounter.value = "";
      this._sendButton.disabled = true;
    }
  },

  /**
   * If the send status is scheduled to reset, then reset it immediately
   * instead of waiting for the timeout to expire.  We do this if the user
   * starts using the form while the send status reset is pending so they can
   * send a message immediately instead of having to wait for the timeout
   * to reset the Send button (which doubles as the status indicator).
   */
  _maybeResetSendStatus: function() {
    if (!this._resetSendStatusTimeoutID)
      return;

    window.clearTimeout(this._resetSendStatusTimeoutID);
    this.resetSendStatus();
  },

  resetSendStatus: function() {
    this._resetSendStatusTimeoutID = null;

    this._sendButton.removeAttribute("state");
    this._sendButton.label = this._strings.get("sendButton.label");
    this._sendButton.disabled = false;
  }

};

window.addEventListener("load", function() { WriteForm.onLoad() }, false);
