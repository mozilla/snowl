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

// On Mac, these constants already exist.  On Windows and Linux they don't.
// So we have to conditionally define them (and thus make them variables).
if (typeof Cc == "undefined")
  var Cc = Components.classes;
if (typeof Ci == "undefined")
  var Ci = Components.interfaces;
if (typeof Cr == "undefined")
  var Cr = Components.results;
if (typeof Cu == "undefined")
  var Cu = Components.utils;

// modules that come with Firefox
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

// modules that are generic
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/StringBundle.js");
Cu.import("resource://snowl/modules/URI.js");

// Snowl-specific modules
Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/feed.js");
Cu.import("resource://snowl/modules/twitter.js");

let SnowlPreferences = {
  // Logger
  get _log() {
    delete this._log;
    return this._log = Log4Moz.repository.getLogger("Snowl.Preferences");
  },

  get _strings() {
    delete this._strings;
    return this._strings =
      new StringBundle("chrome://snowl/locale/preferences.properties");
  },


  //**************************************************************************//
  // Event Handlers

  onLoad: function() {
    this._setTitle();
  },

  /**
   * Set the window title programmatically so it reflects the correct name for
   * preferences on the user's OS (Options on Windows, Preferences elsewhere).
   */
  _setTitle: function() {
    let title;
    switch(Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULRuntime).OS) {
      case "WINNT":
        title = this._strings.get("titleWindows");
        break;
      case "Linux":
      case "Darwin":
      default:
        title = this._strings.get("title");
    }
    document.documentElement.setAttribute("title", title);
  },

  onPaneLoad: function() {
    Subscriber.addObservers();
    window.addEventListener("unload", function() { Subscriber.removeObservers(); }, false);
  },

  onSubscribeFeed: function() {
    // FIXME: support users entering the URLs of sites (or just their hostnames,
    // like "somesite.com", and retrieving the feeds from them automagically).
    let machineURI = URI.get(document.getElementById("locationTextbox").value);
    Subscriber.subscribeFeed(null, machineURI);
  },

  onSubscribeTwitter: function() {
    let credentials = {
      username: document.getElementById("twitterUsername").value,
      password: document.getElementById("twitterPassword").value,
      remember: document.getElementById("rememberTwitterPassword").checked
    };

    Subscriber.subscribeTwitter(null, credentials);
  },

  onShowTwitterPassword: function() {
    if (document.getElementById("showTwitterPassword").checked)
      document.getElementById("twitterPassword").removeAttribute("type");
    else
      document.getElementById("twitterPassword").setAttribute("type", "password");
  },

  selectSubscribeDeck: function() {
    let index = document.getElementById("subscribeRadio").selectedIndex;
    let deck = document.getElementById("subscribeDeck");
    deck.setAttribute("selectedIndex", index);
    this.clearFields();
  },

  clearFields: function() {
    document.getElementById("locationTextbox").value = "";
    document.getElementById("nameTextbox").value = "";
    document.getElementById("twitterUsername").value = "";
    document.getElementById("twitterPassword").value = "";
    SubscriptionListener.setStatus("none", "");
  }

}
