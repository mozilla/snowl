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

  init: function() {
    let lastVersion = this._prefs.get("lastVersion");

    if (!lastVersion) {
      let url = "chrome://snowl/content/firstrun.html";
      setTimeout(function() { window.openUILinkIn(url, "tab") }, 500);
    }
    else if (lastVersion != this._version) {
      let url = "chrome://snowl/content/update.html?old=" + lastVersion +
                "&new=" + this._version;
      setTimeout(function() { window.openUILinkIn(url, "tab") }, 500);
    }

    this._prefs.set("lastVersion", this._version);

    // Intialize places
    SnowlPlaces.init();

    // Init tab listeners
    this._initTabListeners();

    // Init river tab 
    setTimeout(function() { Snowl._initSnowlRiverTab() }, 100);

    let feedButton = document.getElementById("feed-button");
    let feedMenuPopup = feedButton.firstChild;
    let t = this;
    feedButton.addEventListener("click", function(evt) { t._onClickFeedButton(evt) }, true);
    feedMenuPopup.addEventListener("popupshowing", function(evt) { t._onPopupShowingFeedMenu(evt) }, true);
  },


  //**************************************************************************//
  // Menu Popups

  onSnowlMenuPopupShowing: function(event) {
    // River view menuitem checkstate is off if its tab is not selected+focused
    let rivermenuitem = document.getElementById("viewSnowlRiver");
    let isRiverTab = gBrowser.selectedTab.hasAttribute("snowl");
    rivermenuitem.setAttribute("checked", isRiverTab);
  },

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
      window.setTimeout(function() document.getElementById("snowlMenu").appendChild(event.target), 0);
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

    // Header checked state
    let menuitems = document.getElementsByAttribute("name", "snowlHeaderMenuitemGroup");
    let selectedIndex = this._prefs.get("message.headerView");
    if (menuitems) {
      for (var i = 0; i < menuitems.length; i++) {
        menuitems[i].setAttribute("disabled", !this._listMessageHeader());
        if (i == selectedIndex)
          menuitems[i].setAttribute("checked", true);
      }
    }

    // Flat/Grouped init 
    let isFlatList;
    let sidebarDoc = document.getElementById("sidebar").contentDocument;
    let sourcesView = sidebarDoc.getElementById("sourcesView");
    if (sourcesView)
      isFlatList = sourcesView.getAttribute("flat") == "true";

    let hmenuitems = document.getElementsByAttribute("name", "snowlFlatListMenuitemGroup");
    let rivertab = this._snowlRiverTab();
    if (hmenuitems) {
      for (var i = 0; i < hmenuitems.length; i++) {
        hmenuitems[i].setAttribute("disabled", !lchecked && !(rivertab));
        if (i == isFlatList)
          hmenuitems[i].setAttribute("checked", true);
      }
    }

    // Toolbars
    document.getElementById("snowlToolbarMenuitem").setAttribute("disabled",
        (!lchecked && !schecked) ? true : false);
    document.getElementById("snowlViewToolbarMenuitem").setAttribute("disabled",
        (!lchecked) ? true : false)
  },

  // Correct state of button based on message in current tab
  // XXX better to add url change listener?
  onSnowlToggleHeaderButtonMouseover: function(event) {
    event.target.setAttribute("disabled", !this._listMessageHeader());
  },


  //**************************************************************************//
  // Event Handlers

  onRiverView: function() {
    // Unchecking river menuitem, if current tab is snowl river tab, close it
    let snowlRiverTab = this._snowlRiverTab();
    if (gBrowser.selectedTab == snowlRiverTab) {
      this.closeRiverView(gBrowser.selectedTab);
      return;
    }

    // Handle unchecked menuitem
    if (snowlRiverTab != null) {
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
      let tabIndex = gBrowser.mTabContainer.selectedIndex;
      this._mainWindow.setAttribute("snowltabindex", tabIndex);
      gBrowser.mTabs[tabIndex].setAttribute("snowl", "river");

      let riverbroadcaster = document.getElementById("viewSnowlRiver");
      let isRiverTab = gBrowser.selectedTab.hasAttribute("snowl");
      if (riverbroadcaster)
        riverbroadcaster.setAttribute("checked", isRiverTab);
    }
  },

  closeRiverView: function(aTab) {
    gBrowser.removeTab(aTab);
    document.getElementById("viewSnowlRiver").setAttribute("checked", false);
  },

  onTabSelect: function() {
    // Make sure desired header view showing..
    this._toggleHeader("TabSelect");

    // Set checkstate of River broadcaster
    let riverbroadcaster = document.getElementById("viewSnowlRiver");
    let isRiverTab = gBrowser.selectedTab.hasAttribute("snowl");
    if (riverbroadcaster)
      riverbroadcaster.setAttribute("checked", isRiverTab);
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

  _initTabListeners: function() {
    // TabSelect - make sure header state correct
    gBrowser.tabContainer.addEventListener("TabSelect",
        function() { Snowl.onTabSelect("TabSelect"); }, false);

    // TabOpen, TabClose, TabMove - make sure snowl River tab index is correct
    gBrowser.tabContainer.addEventListener("TabOpen",
        function() { Snowl._resetSnowlRiverTabIndex(); }, false);
    gBrowser.tabContainer.addEventListener("TabClose",
        function() { Snowl._resetSnowlRiverTabIndex(); }, false);
    gBrowser.tabContainer.addEventListener("TabMove",
        function() { Snowl._resetSnowlRiverTabIndex(); }, false);
  },

  //**************************************************************************//
  // Buttons, menuitems, commands..

  // Header toggle
  kNoHeader: 0,
  kBriefHeader: 1,
  kFullHeader: 2,

  _toggleHeader: function(val) {
    let contentWindowDoc = gBrowser.selectedBrowser.contentDocument;
    let selectedIndex = null;
    let headerDeck = this._listMessageHeader();
    let button = document.getElementById("snowlToggleHeaderButton");
    if (button)
      button.setAttribute("disabled", !headerDeck ? true : false);

    // Not a snowl message in the tab..
    if (!headerDeck)
      return;

    let briefHeader = new XPCNativeWrapper(contentWindowDoc, "getElementById()")
        .getElementById("briefHeader");
    let fullHeader = new XPCNativeWrapper(contentWindowDoc, "getElementById()")
        .getElementById("fullHeader");
    let menuitems = document.getElementsByAttribute("name", "snowlHeaderMenuitemGroup");

    if (val == "TabSelect")
      // Make sure tab switch reflects header state
      selectedIndex = this._prefs.get("message.headerView");
    else if (val == "Toggle") {
      // Toggled to next in 3 way
      selectedIndex = parseInt(headerDeck.selectedIndex);
      selectedIndex = ++selectedIndex > 2 ? 0 : selectedIndex++;
      this._prefs.set("message.headerView", selectedIndex);
    }
    else if (val == this.kNoHeader) {
      // Passed no header, temporary state, no pref/state changed
      headerDeck.setAttribute("selectedIndex", this.kNoHeader);
      briefHeader.setAttribute("collapsed", true);
      fullHeader.setAttribute("collapsed", true);
      return;
    }
    else {
      // Passed an event from menuitem choice
      selectedIndex = eval(val.target.getAttribute("headerType"));
      val.target.setAttribute("checked", true);
      this._prefs.set("message.headerView", selectedIndex);
    }

    headerDeck.setAttribute("selectedIndex", selectedIndex);
    briefHeader.setAttribute("collapsed", selectedIndex == 1 ? false : true);
    fullHeader.setAttribute("collapsed", selectedIndex == 2 ? false : true);

    if (button)
      button.setAttribute("snowlHeader", selectedIndex == 0 ?
          "none" : (selectedIndex == 1 ? "brief" : "full"));
    if (menuitems) {
      menuitems[selectedIndex].setAttribute("checked", true);
    }
  },

  _listMessageHeader: function() {
    let contentWindowDoc = gBrowser.selectedBrowser.contentDocument;
    let headerDeck = new XPCNativeWrapper(contentWindowDoc, "getElementById()")
        .getElementById("headerDeck");
    return headerDeck;
  },

  // Collections flat/grouped toggle, menu disabled if not in List view
  kFlatListOff: 0,
  kFlatListOn: 1,

  _toggleFlatList: function(val) {
    let sidebarDoc = document.getElementById("sidebar").contentWindow;
    let lchecked = document.getElementById("viewSnowlList").hasAttribute("checked");
    if (lchecked) {
      sidebarDoc.CollectionsView._tree.setAttribute("flat", val ? true : false);
      sidebarDoc.CollectionsView._tree.place = val ?
          SnowlPlaces.queryFlat : SnowlPlaces.queryGrouped;
      // Ensure collection selection maintained
      sidebarDoc.CollectionsView._tree.restoreSelection();
    }

    let rivertab = this._snowlRiverTab();
    if (rivertab) {
      let tabWindowDoc = gBrowser.getBrowserAtIndex(rivertab._tPos).contentWindow;
      let tabDoc = new XPCNativeWrapper(tabWindowDoc).wrappedJSObject;
      tabDoc.CollectionsView._tree.setAttribute("flat", val ? true : false);
      tabDoc.CollectionsView._tree.place = val ?
          SnowlPlaces.queryFlat : SnowlPlaces.queryGrouped;
      // Ensure collection selection maintained
      tabDoc.CollectionsView._tree.restoreSelection();
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
    let gBrowser = document.getElementById("content");
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
  _initSnowlRiverTab: function() {
    let tabIndex = parseInt(this._mainWindow.getAttribute("snowltabindex"));
    if (tabIndex >= 0 && tabIndex <= gBrowser.mTabs.length)
      gBrowser.mTabs[tabIndex].setAttribute("snowl", "river");

    let riverbroadcaster = document.getElementById("viewSnowlRiver");
    let isRiverTab = gBrowser.selectedTab.hasAttribute("snowl");
    if (riverbroadcaster)
      riverbroadcaster.setAttribute("checked", isRiverTab);
  },

  // Need to reset snowl River tab index
  _resetSnowlRiverTabIndex: function () {
    setTimeout(function() {
      let snowlRiverTab = Snowl._snowlRiverTab();
      if (snowlRiverTab) {
        // River tab exists
        let newIndex = snowlRiverTab._tPos;
        Snowl._mainWindow.setAttribute("snowltabindex", newIndex);
      }
      else
        // Tab closed or none, remove it
        Snowl._mainWindow.removeAttribute("snowltabindex");
    }, 200)
  },


  //**************************************************************************//
  // Feed Button

  _onClickFeedButton: function(event) {
    let feeds = gBrowser.selectedBrowser.feeds;
    if (feeds == null)
      return;

    // The title of the feed(s) we're going to show the user.
    // We use the title of the page by default, falling back on a title
    // provided by the feed(s) if necessary.
    let title = gBrowser.selectedBrowser.contentTitle;

    let params = [];
    for (let i = 0; i < feeds.length; ++i) {
      let feed = feeds[i];
      params.push("feed=" + encodeURIComponent(feed.href));
      if (!title && feed.title)
        title = feed.title;
    }

    let href = "chrome://snowl/content/river.xul" + (params.length > 0 ? "?" + params.join("&") : "");
    openUILink(href, event, false, true, false, null);
  },

  _onPopupShowingFeedMenu: function(event) {
    // Suppress the popup's own popupshowing event handler.
    event.preventDefault();
  }

};

Cu.import("resource://snowl/modules/Preferences.js", Snowl);

window.addEventListener("load", function() { Snowl.init() }, false);
