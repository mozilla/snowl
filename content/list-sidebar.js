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

const Cu = Components.utils;

// modules that are generic
Cu.import("resource://snowl/modules/Observers.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/utils.js");

let gBrowserWindow = SnowlService.gBrowserWindow;

let ListSidebar = {

  //**************************************************************************//
  // Shortcuts

  get _writeButton() {
    delete this._writeButton;
    return this._writeButton = document.getElementById("writeButton");
  },

  get _writeForm() {
    delete this._writeForm;
    return this._writeForm = document.getElementById("writeForm");
  },

  get _rebuildDBMenuitem() {
    delete this._rebuildDBMenuitem;
    return this._rebuildDBMenuitem =
        gBrowserWindow.document.getElementById("snowlRebuildDBMenuitem");
  },


  //**************************************************************************//
  // Event & Notification Handlers

  onLoad: function() {
    gBrowserWindow.SnowlMessageView.show(true);
    this._updateWriteButton();
    this._rebuildDBMenuitem.removeAttribute("disabled");
    Observers.add("snowl:source:added",    this.onSourcesChanged, this);
    Observers.add("snowl:source:unstored", this.onSourcesChanged, this);
  },

  onUnload: function() {
    gBrowserWindow.SnowlMessageView.show(false);
    this._rebuildDBMenuitem.setAttribute("disabled", true);
    CollectionsView.unloadObservers();
    Observers.remove("snowl:source:added",    this.onSourcesChanged, this);
    Observers.remove("snowl:source:unstored", this.onSourcesChanged, this);
  },

  onToggleWrite: function(event) {
    this._writeForm.hidden = !event.target.checked;
  },

  onSourcesChanged: function() {
    this._updateWriteButton();
  },

  // Selectively enable/disable the button for writing a message depending on
  // whether or not the user has an account that supports writing.
  _updateWriteButton: function() {
    this._writeButton.disabled = (SnowlService.targetsByID.length == 0);
  }

}
