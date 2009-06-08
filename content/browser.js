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
 *   alta88 <alta88@gmail.com>
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

// We have to import these here, even though we don't use them in this overlay,
// so that they get parsed and register themselves with the service.
Cu.import("resource://snowl/modules/feed.js");
Cu.import("resource://snowl/modules/twitter.js");

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

  get _mainWindow() {
    delete this._mainWindow;
    return this._mainWindow = document.getElementById("main-window");
  },

  get _searchbar() {
    delete this._searchbar;
    return this._searchbar = document.getElementById("searchbar");
  },

  get _riverBroadcaster() {
    delete this._riverBroadcaster;
    return this._riverBroadcaster = document.getElementById("viewSnowlRiver");
  },

  init: function() {
    let lastVersion = this._prefs.get("lastVersion");

    if (!lastVersion) {
      let url = "chrome://snowl/content/firstrun.html";
      setTimeout(function() { window.openUILinkIn(url, "tab") }, 500);
    }
    // Don't show the "updated" page in the dev channel, since we update
    // that channel so often that this behavior would get old fast.
    else if (lastVersion != this._version &&
             this._prefs.get("channel") != "dev") {
      let url = "chrome://snowl/content/update.html?old=" + lastVersion +
                "&new=" + this._version;
      setTimeout(function() { window.openUILinkIn(url, "tab") }, 500);
    }

    this._prefs.set("lastVersion", this._version);

    // Init tab listeners
    this._initTabListeners();

    let feedButton = document.getElementById("feed-button");
    let feedMenuPopup = feedButton.firstChild;
    let t = this;
    feedButton.addEventListener("click", function(evt) { t._onClickFeedButton(evt) }, true);
    feedMenuPopup.addEventListener("popupshowing", function(evt) { t._onPopupShowingFeedMenu(evt) }, true);
  },


  //**************************************************************************//
  // Menu Popups

  onSnowlButtonMouseDown: function(event) {
    // Jumping thru hoops to reuse popup for menupopup and button..
    let popup = document.getElementById("snowlMenuPopup");
    if (event.target.id == "snowlToolbarButton" ||
        event.target.id == "snowlStatusbarButton")
      event.target.appendChild(popup);
  },

  onSnowlMenuPopupHiding: function(event) {
    // Jumping thru hoops to reuse popup for menupopup and button..

    // Move the popup back to the Tools menu (if it isn't there already).
    // Note: we move it back after a timeout to give the toolbarbutton time
    // to react to the hiding of the popup.  Otherwise, it would never see
    // the popuphidden event it uses to changes its appearance from open
    // to closed because the popup would already have been moved out from under
    // the toolbarbutton).
    if (event.target.id == "snowlMenuPopup")
      window.setTimeout(function() document.getElementById("snowlMenu").
                                            appendChild(event.target), 0);
  },

  layoutName: ["classic", "vertical", "widemessage", "widethread", "stacked"],

  onLayoutPopupShowing: function(event) {
    // Layout checked state
    let layoutmenu = document.getElementById("snowlLayoutMenu");
    let lchecked = document.getElementById("viewSnowlList").hasAttribute("checked");
    let schecked = document.getElementById("viewSnowlStream").hasAttribute("checked");
    let layoutmenuitems = document.getElementsByAttribute("name", "snowlLayoutMenuitemGroup");
    let layout = this._mainWindow.getAttribute("snowllayout");
    let layoutIndex = this.layoutName.indexOf(layout);

    if (layoutmenuitems) {
      for (var i = 0; i < layoutmenuitems.length; i++) {
        layoutmenuitems[i].setAttribute("disabled", !lchecked);
        if (i == layoutIndex)
          layoutmenuitems[i].setAttribute("checked", true);
      }
    }

    // Toolbars
    document.getElementById("snowlToolbarMenuitem").setAttribute("disabled",
        (!lchecked && !schecked) ? true : false);
    document.getElementById("snowlViewToolbarMenuitem").setAttribute("disabled",
        (!lchecked) ? true : false)
  },


  //**************************************************************************//
  // Event Handlers

  onRiverView: function() {
    // Unchecking river menuitem, if current tab is snowl river tab, close it
    let snowlRiverTab = this._snowlRiverTab();
    if (gBrowser.selectedTab == snowlRiverTab) {
      gBrowser.removeTab(gBrowser.selectedTab);
      return;
    }

    // Handle unchecked menuitem
    if (snowlRiverTab) {
      // Snowl River tab is already open, focus it
      gBrowser.selectedTab = snowlRiverTab;
      gBrowser.focus();
    }
    else {
      // River tab not open, create a new one, toggle other views in sidebar 'off'
//      let lchecked = document.getElementById("viewSnowlList").hasAttribute("checked");
//      let schecked = document.getElementById("viewSnowlStream").hasAttribute("checked");
//      if (lchecked)
//        toggleSidebar('viewSnowlList');
//      if (schecked)
//        toggleSidebar('viewSnowlStream');

      gBrowser.selectedTab = gBrowser.addTab("chrome://snowl/content/river.xul");
      SnowlService._ssSvc.setTabValue(gBrowser.selectedTab, "snowl", "river");
      gBrowser.selectedTab.setAttribute("snowl", "river");
      this._riverBroadcaster.setAttribute("checked", true);
    }
  },

  onTabSelect: function() {
    // Make sure desired header view showing.
    this.onSetHeader();

    // Set checkstate of River broadcaster.
    if (gBrowser.selectedTab.hasAttribute("snowl"))
      this._riverBroadcaster.setAttribute("checked", true);
    else
      this._riverBroadcaster.removeAttribute("checked");
  },

  onCheckForNewMessages: function() {
    SnowlService.refreshAllSources();
  },

  onSubscribe: function() {
    return this.openSnowlPreferences("subscribe");
  },

  openSnowlPreferences: function(paneID, extraArgs) {
//    let instantApply = getBoolPref("browser.preferences.instantApply", false);
    let instantApply = true;
    let features = "chrome,titlebar,toolbar,resizable=yes" +
        (instantApply ? ",dialog=no" : ",modal");

    let wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                       .getService(Components.interfaces.nsIWindowMediator);
    let win = wm.getMostRecentWindow("Snowl:Preferences");
    if (win) {
      win.focus();
      if (paneID) {
        var pane = win.document.getElementById(paneID);
        win.document.documentElement.showPane(pane);
      }

      return win;
    }

    return openDialog("chrome://snowl/content/preferences.xul",
                      "SnowlPreferences", features, paneID, extraArgs);
  },

  onImportOPML: function() {
    Subscriber.importOPML();
  },

  onExportOPML: function() {
    SnowlOPML.export(window);
  },

  onSessionRestored: function(aEvent) {
    Snowl._initSnowlRiverTab(aEvent.originalTarget);
  },

  _initTabListeners: function() {
    // TabSelect - make sure header state correct
    gBrowser.tabContainer.addEventListener("TabSelect",
        function() { Snowl.onTabSelect(); }, false);

    gBrowser.tabContainer.addEventListener("SSTabRestoring",
        function(event) { Snowl.onSessionRestored(event); }, false);
  },

  //**************************************************************************//
  // Buttons, menuitems, commands..

  onSetHeader: function(aEvent) {
    if (aEvent) {
      let checked = aEvent.target.getAttribute("checked") == "true";
      document.getElementById("viewSnowlHeader").setAttribute("checked", checked);
    }

    let contentDoc = gBrowser.selectedBrowser.contentDocument;
    let messageHeader = contentDoc.getElementById("messageHeader");

    // If a snowl message in the tab, send an event to the pin button.
    if (messageHeader) {
      let event = document.createEvent("Events");
      event.initEvent("broadcast", false, true);
      let pin = messageHeader.contentDocument.getElementById("pinButton");
      pin.dispatchEvent(event);
    }
  },

  // Need to init onLoad due to xul structure, toolbar exists in list and stream
  _initSnowlToolbar: function() {
    let menuitem = document.getElementById("snowlToolbarMenuitem");
    let doc = document.getElementById("sidebar").contentDocument;
    let toolbar = doc.getElementById("snowlToolbar");

    if (toolbar) {
      menuitem.setAttribute("checked", !toolbar.hidden);
    }
  },

  _toggleToolbar: function(event) {
    let name = event.target.getAttribute("name");
    let menuitem = document.getElementById(name+"Menuitem");
    let doc, toolbar, rtoolbar = null;

    if (name == "snowlToolbar") {
      doc = document.getElementById("sidebar").contentDocument;
      let rivertab = this._snowlRiverTab();
      if (rivertab)
        rtoolbar = gBrowser.getBrowserAtIndex(rivertab._tPos).
                   contentDocument.getElementById(name);
    }
    else 
      doc = document;

    toolbar = doc.getElementById(name);
    if (toolbar) {
      toolbar.hidden = !toolbar.hidden;
      menuitem.setAttribute("checked", !toolbar.hidden);
    }
    if (rtoolbar)
      rtoolbar.hidden = !rtoolbar.hidden;
  },

  // See if River tab exists
  _snowlRiverTab: function() {
    // Could be null if none else a reference to the tab
    let snowlTab = null;
    let snowlTabOpen = false;
    
    for (let index = 0; index < gBrowser.mTabs.length && !snowlTabOpen; index++) {
      // Get the next tab
      let currentTab = gBrowser.mTabs[index];
      if (currentTab.hasAttribute("snowl")) {
        snowlTabOpen = true;
        snowlTab = currentTab;
      }
    }
    return snowlTab;
  },

  // Need to init snowl River tab, if exists
  _initSnowlRiverTab: function(aTab) {
    if (aTab.localName != "tab")
      return;

    if (SnowlService._ssSvc.getTabValue(aTab, "snowl") == "river") {
      aTab.setAttribute("snowl", "river");
      this._riverBroadcaster.setAttribute("checked", true);
      gBrowser.tabContainer.removeEventListener("SSTabRestoring",
          function(event) { Snowl.onSessionRestored(event); }, false);
    }

    if (aTab.hasAttribute("last-tab"))
      gBrowser.tabContainer.removeEventListener("SSTabRestoring",
          function(event) { Snowl.onSessionRestored(event); }, false);
  },


  //**************************************************************************//
  // Feed Button

  _onClickFeedButton: function(event) {
    // How could this happen?  Users shouldn't be able to click the button
    // if there are no feeds.
    // FIXME: figure out if we need this and what to do if we encounter it.
    if (gBrowser.selectedBrowser.feeds == null)
      return;

    let feeds = SnowlUtils.canonicalizeFeeds(gBrowser.selectedBrowser.feeds,
                                             gBrowser.selectedBrowser.contentTitle);

    // Open the river view, passing it the feeds to preview.
    let param = "feedsToSubscribe=" + encodeURIComponent(JSON.stringify(feeds));
    let href = "chrome://snowl/content/river.xul?" + param;
    openUILink(href, event, false, true, false, null);
  },

  _onPopupShowingFeedMenu: function(event) {
    // Suppress the popup's own popupshowing event handler.
    event.preventDefault();
  }

};

Cu.import("resource://snowl/modules/Preferences.js", Snowl);

window.addEventListener("load", function() { Snowl.init() }, false);
