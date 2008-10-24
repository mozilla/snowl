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
      // We don't use this code yet because we haven't yet set up update.html
      // to properly list changes yet.
      // FIXME: make this work.
      //let url = "chrome://snowl/content/update.html?old=" + lastVersion +
      //          "&new=" + this._version;
      //setTimeout(function() { window.openUILinkIn(url, "tab"); }, 500);
    }

    this._prefs.set("lastVersion", this._version);

    // Init tab listeners
    this._initTabListeners();

    // Init river tab 
    setTimeout(function() { Snowl._initSnowlRiverTab() }, 100);

  },

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

  //**************************************************************************//
  // Menu Popup Sharing

  // The menu popup through which users can access Snowl commands is accessible
  // from both a menu item in the Tools menu and a statusbar button.  This code
  // shares the same popup between those two elements so we don't have to
  // duplicate the popup code.

  onStatusbarButtonMouseDown: function(event) {
    let menuPopup = document.getElementById('snowlMenuPopup');
    let statusbarButton = document.getElementById("snowlStatusbarButton");
    let toolbarButton = document.getElementById("snowlToolbarButton");

    // If the menu popup isn't on the statusbar or toolbar button, then move it
    // onto the button so the popup appears when the user clicks the button.
    // We'll move the popup back to the Tools > Snowl menu when the popup hides.
    if (event.target.id == "snowlToolbarButton" &&
        menuPopup.parentNode != toolbarButton)
      toolbarButton.appendChild(menuPopup);
    if (event.target.id == "snowlStatusbarButton" &&
        menuPopup.parentNode != statusbarButton)
      statusbarButton.appendChild(menuPopup);
  },

  onPopupShowing: function(event) {
    // River view menuitem checkstate is off if its tab is not selected+focused
    let rivermenuitem = document.getElementById("viewSnowlRiver");
    let isRiverTab = gBrowser.selectedTab.hasAttribute("snowl");
    rivermenuitem.setAttribute("checked", isRiverTab);

    // Header checked state
    let menuitems = document.getElementsByAttribute("name", "snowlHeaderMenuitemGroup");
    let selectedIndex = this._prefs.get("message.headerView");
    if (menuitems)
      menuitems[selectedIndex].setAttribute("checked", true);
  },

  layoutName: ["classic", "vertical", "widemessage", "widethread", "stacked"],

  onLayoutPopupShowing: function(event) {
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
    document.getElementById("snowlToolbarMenuitem").setAttribute("disabled",
        (!lchecked && !schecked) ? true : false);
    document.getElementById("snowlViewToolbarMenuitem").setAttribute("disabled",
        (!lchecked) ? true : false)
  },

  onPopupHiding: function(event) {
    let menuPopup = document.getElementById("snowlMenuPopup");
    let menu = document.getElementById("snowlMenu");
    event.target.parentNode.removeAttribute("open");

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
    }
  },

  closeRiverView: function(aTab) {
    gBrowser.removeTab(aTab);
    document.getElementById("viewSnowlRiver").setAttribute("checked", false);
  },

  onTabSelect: function() {
    // Make sure desired header view showing..
    this._toggleHeader("TabSelect");
    // others..
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
    let headerDeck = new XPCNativeWrapper(contentWindowDoc, "getElementById()")
        .getElementById("headerDeck");

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
    let doc = (name == "snowlToolbar") ?
        document.getElementById("sidebar").contentDocument : document;
    let toolbar = doc.getElementById(name);

    if (toolbar) {
      toolbar.hidden = !toolbar.hidden;
      menuitem.setAttribute("checked", !toolbar.hidden);
    }
  },

  // Need to init snowl River tab, if exists
  _initSnowlRiverTab: function() {
    let tabIndex = parseInt(this._mainWindow.getAttribute("snowltabindex"));
    if (tabIndex >= 0 && tabIndex <= gBrowser.mTabs.length)
      gBrowser.mTabs[tabIndex].setAttribute("snowl", "river");
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

};

Cu.import("resource://snowl/modules/Preferences.js", Snowl);

window.addEventListener("load", function() { Snowl.init() }, false);
