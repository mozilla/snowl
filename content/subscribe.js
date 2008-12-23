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

let gBrowserWindow = window.QueryInterface(Ci.nsIInterfaceRequestor).
                     getInterface(Ci.nsIWebNavigation).
                     QueryInterface(Ci.nsIDocShellTreeItem).
                     rootTreeItem.
                     QueryInterface(Ci.nsIInterfaceRequestor).
                     getInterface(Ci.nsIDOMWindow);

function SubscriptionListener(subject, topic, data) {
  let source = Subscriber.account;

  // Don't track the status of subscriptions happening in other windows/tabs.
  if (subject != source)
    return;

    let code, message;
    // If blank, fine
    let identity = source.name;
    let stringBundle = document.getElementById("snowlStringBundle");

  switch(topic) {
    case "snowl:subscribe:connect:start":
      code = "active";
      message = stringBundle.getString("messageConnecting");
      break;
    case "snowl:subscribe:connect:end":
      if (data.split(":")[0] == "duplicate") {
        code = "error";
        message = stringBundle.getString("messageDuplicate");
        identity = data.split(":")[1];
      }
      else if (data == "invalid") {
        code = "error";
        message = stringBundle.getString("messageInvalid");
      }
      else if (data == "logindata") {
        code = "error";
        message = stringBundle.getString("messageInvalidLoginData");
      }
      else if (data < 200 || data > 299) {
        code = "error";
        message = stringBundle.getString("messageConnectionError");
        if (data == 401)
          message = stringBundle.getString("messagePassword");
      }
      else {
        // Under most circumstances, this message will be replaced immediately
        // by the "getting messages" message.
        code = "complete";
        message = stringBundle.getString("messageConnected");
      }
      break;
    case "snowl:subscribe:get:start":
      code = "active";
      message = stringBundle.getString("messageGettingMessages");
      break;
    case "snowl:subscribe:get:progress":
      return;
      break;
    case "snowl:subscribe:get:end":
      code = "complete";
      message = stringBundle.getString("messageSuccess");
      break;
  }
  Subscriber.setStatus(code, message, identity);
}

let Subscriber = {
  // Logger
  get _log() {
    delete this._log;
    return this._log = Log4Moz.repository.getLogger("Snowl.Subscribe");
  },

  setStatus: function(code, message, identity) {
    let nameBox = document.getElementById("nameTextbox");
    nameBox.setAttribute("value", identity);
    let statusIcon = document.getElementById("statusIcon");
    let statusMessage = document.getElementById("statusMessage");
    statusIcon.setAttribute("status", code);

    while (statusMessage.hasChildNodes())
      statusMessage.removeChild(statusMessage.firstChild);

    statusMessage.appendChild(document.createTextNode(message));
  },


  //**************************************************************************//
  // Initialization & Destruction

  onLoad: function() {
    this.addObservers();

    // Parse URL parameters
    let paramString = window.location.search.substr(1);
    let params = {};
    for each (let param in paramString.split("&")) {
      let [name, value] = param.split("=");
      if (value)
        params[name] = decodeURIComponent(value);
      else
        params[name] = value;
    }

    if (params.feed) {
      document.getElementById("locationTextbox").value = params.feed;
      this.subscribeFeed(null, URI.get(params.feed));
    }
  },

  onUnload: function() {
    this.removeObservers();
  },

  addObservers: function() {
    Observers.add(SubscriptionListener, "snowl:subscribe:connect:start");
    Observers.add(SubscriptionListener, "snowl:subscribe:connect:end");
    Observers.add(SubscriptionListener, "snowl:subscribe:get:start");
    Observers.add(SubscriptionListener, "snowl:subscribe:get:progress");
    Observers.add(SubscriptionListener, "snowl:subscribe:get:end");
},

  removeObservers: function() {
    Observers.remove(SubscriptionListener, "snowl:subscribe:connect:start");
    Observers.remove(SubscriptionListener, "snowl:subscribe:connect:end");
    Observers.remove(SubscriptionListener, "snowl:subscribe:get:start");
    Observers.remove(SubscriptionListener, "snowl:subscribe:get:progress");
    Observers.remove(SubscriptionListener, "snowl:subscribe:get:end");
  },


  //**************************************************************************//
  // Event Handlers

  // Dismiss subscribe page, don't close tab. It would be nice to remove
  // the page from session history, but it doesn't seem there's a way..
  onClose: function() {
    gBrowserWindow.BrowserBack();
  },


  //**************************************************************************//
  // OPML Import

  importOPML: function() {
    let fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(window, "Import OPML", Ci.nsIFilePicker.modeOpen);
    fp.appendFilter("OPML Files", "*.opml");
    fp.appendFilters(Ci.nsIFilePicker.filterXML);
    fp.appendFilters(Ci.nsIFilePicker.filterAll);

    let rv = fp.show();
    if (rv != Ci.nsIFilePicker.returnOK)
      return;

    // FIXME: use a file utility to open the file instead of XMLHttpRequest
    // and then use the DOM parser to parse it to XML.
    let request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].
                  createInstance(Ci.nsIXMLHttpRequest);
    request.open("GET", fp.fileURL.spec, false);
    // Since the file probably ends in .opml, we have to force XHR to treat it
    // as XML by overriding the MIME type it would otherwise select.
    request.overrideMimeType("text/xml");
    request.send(null);
    let xmlDocument = request.responseXML;

    let outline = xmlDocument.getElementsByTagName("body")[0];

    this._importOutline(outline);
  },

  _importOutline: strand(function(outline) {
    let name = outline.getAttribute("title") || outline.getAttribute("text");

    if (outline.getAttribute("type") == "twitter") {
      let credentials = { username: outline.getAttribute("username") };
      this.subscribeTwitter(name, credentials);
      yield sleep(100);
    }
    // If it has an xmlUrl attribute, assume it's a feed.
    else if (outline.hasAttribute("xmlUrl")) {
      let machineURI = URI.get(outline.getAttribute("xmlUrl"));
      this.subscribeFeed(name, machineURI);
      yield sleep(100);
    }

    // Import the outline's children.
    if (outline.hasChildNodes()) {
      let children = outline.childNodes;
      for (let i = 0; i < children.length; i++) {
        let child = children[i];

        // Only deal with "outline" elements; ignore text, etc. nodes.
        if (child.nodeName != "outline")
          continue;

        yield this._importOutline(child);
      }
    }
  }),


  //**************************************************************************//
  // Subscribe

  subscribeTwitter: strand(function(name, credentials, callback) {
    this._log.info("subscribing to Twitter account " + name + " with username " + credentials.username);

    this.account = new SnowlTwitter(null, name);

    if (!credentials.username) {
      this._log.info("can't subscribe to Twitter account " + name + ": no username");
      Observers.notify(this.account, "snowl:subscribe:connect:end", "logindata");
      // FIXME: reset this.account to null here.
      return;
    }

    let [name, username] = SnowlService.hasSourceUsername(this.account.machineURI.spec, credentials.username);
    if (name && credentials.username == username) {
      this._log.info("can't subscribe to Twitter account " + name + ": duplicate");
      Observers.notify(this.account, "snowl:subscribe:connect:end", "duplicate:" + username);
      // FIXME: reset this.account to null here.
      return;
    }

    let future = new Future();
    this.account.subscribe(credentials, future.fulfill);
    yield future.result();

    this.account = null;

    if (callback)
      callback();
  }),

  subscribeFeed: strand(function(name, machineURI, callback) {
    this._log.info("subscribing to feed " + name + " <" + machineURI.spec + ">");

    // FIXME: fix the API so I don't have to pass a bunch of null and undefined
    // values (that undefined value, incidentally, can probably be null).
    this.account = new SnowlFeed(null, name, machineURI, undefined, null);

    // FIXME: move this above the object instantiation above, as there's
    // no point creating an object when we don't even have a valid URI to assign
    // to it.  Unfortunately, this gets complicated, as the observer assumes
    // the presence of the account property in this object (a dependency we will
    // have to break).
    if (!machineURI) {
      Observers.notify(this.account, "snowl:subscribe:connect:end", "invalid");
      this._log.error("could not subscribe to feed: no machine URI");
      // FIXME: reset this.account to null here.
      return;
    }

    let name = SnowlService.hasSource(machineURI.spec);
    if (name) {
      Observers.notify(this.account, "snowl:subscribe:connect:end", "duplicate:" + name);
      this._log.error("could not subscribe to feed: duplicate");
      // FIXME: reset this.account to null here.
      return;
    }

    let future = new Future();
    this.account.subscribe(future.fulfill);
    yield future.result();

    this.account = null;

    if (callback)
      callback();
  })

};
