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

Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/opml.js");

let Snowl = {
  // The Preferences service that is imported from the Preferences module below.
  // XXX Could we import it lazily when this property is first accessed?
  Preferences: null,

  get _prefs() {
    delete this._prefs;
    return this._prefs = new this.Preferences("extensions.snowl.");
  },

  get _version() {
    let em = Cc["@mozilla.org/extensions/manager;1"].
             getService(Ci.nsIExtensionManager);
    let addon = em.getItemForID("snowl@mozilla.org");
    delete this._version;
    return this._version = addon.version;
  },

  init: function() {
    let lastVersion = this._prefs.get("lastVersion");

    if (!lastVersion) {
      let url = "chrome://snowl/content/firstrun.html";
      setTimeout(function() { window.openUILinkIn(url, "tab") }, 500);
    }
    else if (lastVersion != this._version) {
      // We don't use this code yet because we haven't yet set up update.html
      // to properly list changes yet.
      // FIXME: make this work.
      //let url = "chrome://snowl/content/update.html?old=" + lastVersion +
      //          "&new=" + this._version;
      //setTimeout(function() { window.openUILinkIn(url, "tab"); }, 500);
    }

    this._prefs.set("lastVersion", this._version);
  },

  //**************************************************************************//
  // Menu Popup Sharing

  // The menu popup through which users can access Snowl commands is accessible
  // from both a menu item in the Tools menu and a statusbar button.  This code
  // shares the same popup between those two elements so we don't have to
  // duplicate the popup code.

  onStatusbarButtonMouseDown: function(event) {
    let menuPopup = document.getElementById('snowlMenuPopup');
    let statusbarButton = document.getElementById("snowlStatusbarButton");

    // If the menu popup isn't on the statusbar button, then move the popup
    // onto the button so the popup appears when the user clicks the button.
    // We'll move the popup back to the Tools > Snowl menu when the popup hides.
    if (menuPopup.parentNode != statusbarButton)
      statusbarButton.appendChild(menuPopup);
  },

  onPopupHiding: function() {
    let menuPopup = document.getElementById("snowlMenuPopup");
    let menu = document.getElementById("snowlMenu");

    // If the menu popup isn't on the Tools > Snowl menu, then move the popup
    // back onto that menu so the popup appears when the user selects the menu.
    // We'll move the popup back to the statusbar button when the user clicks
    // on that button.
    if (menuPopup.parentNode != menu)
      menu.appendChild(menuPopup);
  },


  //**************************************************************************//
  // Event Handlers

  onRiverView: function() {
    gBrowser.selectedTab = gBrowser.addTab("chrome://snowl/content/river.xul");
  },

  onCheckForNewMessages: function() {
    SnowlService.refreshAllSources();
  },

  onSubscribe: function() {
    gBrowser.selectedTab =
      gBrowser.addTab("chrome://snowl/content/subscribe.xul");
  },

  onImportOPML: function() {
    gBrowser.selectedTab =
      gBrowser.addTab("chrome://snowl/content/subscribe.xul?tab=opml");
  },

  onExportOPML: function() {
    SnowlOPML.export(window);
  }

};

Cu.import("resource://snowl/modules/Preferences.js", Snowl);

window.addEventListener("load", function() { Snowl.init() }, false);
