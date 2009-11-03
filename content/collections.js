diff --git a/content/collections.css b/content/collections.css
--- a/content/collections.css
+++ b/content/collections.css
@@ -87,11 +87,17 @@
  * valid for a row property; no amount of view nulling etc etc could fix this.
  * It seems the tree keeps invalidating itself once an anim image is loaded.
   list-style-image: url("chrome://global/skin/icons/loading_16.png");
 */
   list-style-image: url("chrome://snowl/content/icons/arrow_refresh_small.png");
 }
 
 /* Error on collection indicator */
-#sourcesViewTreeChildren::-moz-tree-image(hasError) {
+#sourcesViewTreeChildren::-moz-tree-image(hasError),
+#sourcesViewTreeChildren::-moz-tree-image(isDisabled) {
   list-style-image: url("chrome://snowl/content/icons/exclamation.png");
 }
+
+/* Source is paused/disabled */
+#sourcesViewTreeChildren::-moz-tree-cell-text(isDisabled) {
+  color: GrayText;
+}
diff --git a/content/collections.js b/content/collections.js
--- a/content/collections.js
+++ b/content/collections.js
@@ -83,16 +83,21 @@ let CollectionsView = {
     return this._collectionsViewMenuPopup = document.getElementById("collectionsViewMenuPopup");
   },
 
   get _listToolbar() {
     delete this._listToolbar;
     return this._listToolbar = document.getElementById("snowlListToolbar");
   },
 
+  get _refreshButton() {
+    delete this._toggleListToolbarButton;
+    return this._toggleListToolbarButton = document.getElementById("snowlRefreshButton");
+  },
+
   get _toggleListToolbarButton() {
     delete this._toggleListToolbarButton;
     return this._toggleListToolbarButton = document.getElementById("listToolbarButton");
   },
 
   get itemIds() {
     let intArray = [];
     let strArray = this._tree.getAttribute("itemids").split(",");
@@ -214,16 +219,19 @@ let CollectionsView = {
     if (this.isMessageForSelectedCollection(message)) {
       gMessageViewWindow.SnowlMessageView.onMessageAdded(message);
     }
   },
 
   onMessagesCompleted: function(aSourceId) {
     // Source refresh completed, refresh tree.
     this._tree.treeBoxObject.invalidate();
+    // Enable refresh button.
+    if (SnowlService.refreshingCount == 0)
+      this._refreshButton.removeAttribute("disabled");
   },
 
   onSourceRemoved: function() {
 //this._log.info("onSourceRemoved: curIndex:gMouseEvent - "+
 //  this._tree.currentIndex+" : "+SnowlUtils.gMouseEvent);
     if (!this._tree.selectedNode) {
       // Original selected row removed, reset and clear.
       this._tree.currentIndex = -1;
@@ -334,16 +342,17 @@ this._log.info("onClick: START itemIds -
     SnowlUtils.RestoreSelection(aEvent, this._tree);
   },
 
   onSubscribe: function() {
     SnowlService.gBrowserWindow.Snowl.onSubscribe();
   },
 
   onRefresh: function() {
+    this._refreshButton.setAttribute("disabled", true);
     SnowlService.refreshAllSources();
   },
 
   onToggleListToolbar: function(aEvent) {
     aEvent.target.checked = !aEvent.target.checked;
     if (this._listToolbar.hasAttribute("hidden"))
       this._listToolbar.removeAttribute("hidden");
     else
@@ -1240,20 +1249,23 @@ function SnowlTreeViewGetCellProperties(
            query.queryFolder == SnowlPlaces.collectionsAuthorsID) ? "all" : null;
   source = SnowlService.sourcesByID[query.queryID];
 
   nodeStats = SnowlService.getCollectionStatsByCollectionID()[collID];
   if (nodeStats && nodeStats.u && !node.containerOpen)
     aProperties.AppendElement(this._getAtomFor("hasUnread"));
   if (nodeStats && nodeStats.n && !node.containerOpen)
     aProperties.AppendElement(this._getAtomFor("hasNew"));
-  if (((source && source.busy) || (nodeStats && nodeStats.busy)) && !node.containerOpen)
+  if (((source && source.busy) || (collID == "all" && SnowlService.refreshingCount > 0)) && !node.containerOpen)
     aProperties.AppendElement(this._getAtomFor("isBusy"));
   if (source && source.error && !node.containerOpen)
     aProperties.AppendElement(this._getAtomFor("hasError"));
+  if (source && source.attributes["refreshStatus"] &&
+      source.attributes["refreshStatus"] == "disabled" && !node.containerOpen)
+    aProperties.AppendElement(this._getAtomFor("isDisabled"));
 
   if ((query.queryFolder != SnowlPlaces.collectionsSourcesID &&
        query.queryFolder != SnowlPlaces.collectionsAuthorsID) &&
       PlacesUtils.nodeIsContainer(node) && node.hasChildren && !node.containerOpen) {
     // For custom view shortcuts and any user created folders.
     childStats = CollectionsView.getCollectionChildStats(node);
     if (childStats && childStats.u)
       aProperties.AppendElement(this._getAtomFor("hasUnreadChildren"));
@@ -1320,17 +1332,18 @@ function SnowlTreeViewGetImageSrc(aRow, 
                query.queryTypeAuthor ? "a" + query.queryID :
               (query.queryFolder == SnowlPlaces.collectionsSystemID ||
                query.queryFolder == SnowlPlaces.collectionsSourcesID ||
                query.queryFolder == SnowlPlaces.collectionsAuthorsID) ? "all" : null;
   let nodeStats = SnowlService.getCollectionStatsByCollectionID()[collID];
   let source = SnowlService.sourcesByID[query.queryID];
 
   if ((nodeStats && (nodeStats.n || nodeStats.busy)) ||
-      (source && (source.busy || source.error)))
+      (source && (source.busy || source.error ||
+      (source.attributes["refreshStatus"] && source.attributes["refreshStatus"] == "disabled"))))
     // Don't set icon, let css handle it for 'new' or 'busy' or 'error'.
     // "all" collection (only) has a busy property so we can set an indicator on
     // a closed container.
     return "";
 
   var icon = node.icon;
   if (icon)
     return icon.spec;
diff --git a/content/subscribe.js b/content/subscribe.js
--- a/content/subscribe.js
+++ b/content/subscribe.js
@@ -55,30 +55,35 @@ let SubscriptionListener = {
     if (subject != source)
       return;
   
     let code, message, errorMsg;
     // If blank, fine
     let identity = source.name;
 
     switch(topic) {
-      case "snowl:subscribe:connect:start":
+      case "snowl:refresh:connect:start":
         code = "active";
         message = this.stringBundle.getString("messageConnecting");
         break;
-      case "snowl:subscribe:connect:end":
+      case "snowl:refresh:connect:end":
         if (data.split(":")[0] == "duplicate") {
           this.duplicate(data);
         }
         else if (data == "invalid") {
           this.invalid(data);
         }
         else if (data == "logindata") {
           this.logindata(data);
         }
+        else if (data.split(":", 1)[0] == "error" &&
+                 source.attributes["statusCode"] == "db:transactionInProgress") {
+          code = "error";
+          message = this.stringBundle.getString("messageDbBusy");
+        }
         else if (data.split(":", 1)[0] == "error") {
           code = "error";
           errorMsg = data.split("error:")[1];
           message = this.stringBundle.getFormattedString("messageGenericError", [errorMsg]);
         }
         else if (data < 200 || data > 299) {
           code = "error";
           message = this.stringBundle.getString("messageConnectionError");
@@ -87,24 +92,21 @@ let SubscriptionListener = {
         }
         else {
           // Under most circumstances, this message will be replaced immediately
           // by the "getting messages" message.
           code = "complete";
           message = this.stringBundle.getString("messageConnected");
         }
         break;
-      case "snowl:subscribe:get:start":
+      case "snowl:refresh:get:start":
         code = "active";
         message = this.stringBundle.getString("messageGettingMessages");
         break;
-      case "snowl:subscribe:get:progress":
-        return;
-        break;
-      case "snowl:subscribe:get:end":
+      case "snowl:refresh:get:end":
         code = "complete";
         message = this.stringBundle.getString("messageSuccess");
         break;
     }
 
     this.setStatus(code, message, identity);
   },
   
@@ -178,29 +180,27 @@ let Subscriber = {
 
   onUnload: function() {
     this.removeObservers();
   },
 
   addObservers: function() {
     // FIXME: integrate the subscription listener into this object
     // as individual notification handler functions.
-    Observers.add("snowl:subscribe:connect:start", SubscriptionListener);
-    Observers.add("snowl:subscribe:connect:end",   SubscriptionListener);
-    Observers.add("snowl:subscribe:get:start",     SubscriptionListener);
-    Observers.add("snowl:subscribe:get:progress",  SubscriptionListener);
-    Observers.add("snowl:subscribe:get:end",       SubscriptionListener);
+    Observers.add("snowl:refresh:connect:start", SubscriptionListener);
+    Observers.add("snowl:refresh:connect:end",   SubscriptionListener);
+    Observers.add("snowl:refresh:get:start",     SubscriptionListener);
+    Observers.add("snowl:refresh:get:end",       SubscriptionListener);
   },
 
   removeObservers: function() {
-    Observers.remove("snowl:subscribe:connect:start", SubscriptionListener);
-    Observers.remove("snowl:subscribe:connect:end",   SubscriptionListener);
-    Observers.remove("snowl:subscribe:get:start",     SubscriptionListener);
-    Observers.remove("snowl:subscribe:get:progress",  SubscriptionListener);
-    Observers.remove("snowl:subscribe:get:end",       SubscriptionListener);
+    Observers.remove("snowl:refresh:connect:start", SubscriptionListener);
+    Observers.remove("snowl:refresh:connect:end",   SubscriptionListener);
+    Observers.remove("snowl:refresh:get:start",     SubscriptionListener);
+    Observers.remove("snowl:refresh:get:end",       SubscriptionListener);
   },
 
 
   //**************************************************************************//
   // Event Handlers
 
   // Dismiss subscribe page, don't close tab. It would be nice to remove
   // the page from session history, but it doesn't seem there's a way..
@@ -300,38 +300,17 @@ let Subscriber = {
       return;
     }
 
     this._log.info("subscribing to Twitter" + (aName ? " account " + aName : "") +
                    " with username " + aCredentials.username);
 
     this.account.username = aCredentials.username;
 
-    this.account.refresh(null);
-
-    // If error on connect, do not persist.
-    if (this.account.error) {
-      Observers.notify("snowl:subscribe:connect:end", this.account, "error:" + this.account.lastStatus);
-      this.account = null;
-      return;
-    }
-
-    this.account.persist();
-
-    // If error on db, don't show success.
-    if (this.account.error) {
-      Observers.notify("snowl:subscribe:connect:end", this.account, "error:" + this.account.lastStatus);
-      this.account = null;
-      return;
-    }
-
-    this.account = null;
-
-    if (aCallback)
-      aCallback();
+    this.doSubscribe();
   },
 
   subscribeFeed: function(aName, aMachineURI, aCallback) {
     if (!aMachineURI) {
       SubscriptionListener.invalid("invalid");
       return;
     }
 
@@ -342,31 +321,35 @@ let Subscriber = {
     }
 
     this._log.info("subscribing to feed " + (aName ? aName : "") +
                    " <" + (aMachineURI ? aMachineURI.spec : "") + ">");
 
     // FIXME: fix the API so I don't have to pass a bunch of null values.
     this.account = new SnowlFeed(null, aName, aMachineURI, null, null);
 
+    this.doSubscribe();
+  },
+
+  doSubscribe: function() {
     this.account.refresh(null);
 
     // If error on connect, or error due to null result.doc (not a feed) despite
     // a successful connect (filtered bad domain or not found url), do not persist.
     if (this.account.error) {
-      Observers.notify("snowl:subscribe:connect:end", this.account, "error:" + this.account.lastStatus);
+      Observers.notify("snowl:refresh:connect:end", this.account, "error:" + this.account.lastStatus);
       this.account = null;
       return;
     }
 
     this.account.persist();
 
     // If error on db, don't show success.
     if (this.account.error) {
-      Observers.notify("snowl:subscribe:connect:end", this.account, "error:" + this.account.lastStatus);
+      Observers.notify("snowl:refresh:connect:end", this.account, "error:" + this.account.lastStatus);
       this.account = null;
       return;
     }
 
     this.account = null;
 
     if (aCallback)
       aCallback();
diff --git a/locale/en-US/preferences.properties b/locale/en-US/preferences.properties
--- a/locale/en-US/preferences.properties
+++ b/locale/en-US/preferences.properties
@@ -1,14 +1,15 @@
 # Status messages when subscribing
 messageConnecting       = Connecting...
 messageDuplicate        = You are already subscribed to this message source.
 messageInvalid          = The location you entered is not recognizable.
 messageInvalidLoginData = You have to enter a username and password to subscribe to this message source.
 messageConnectionError  = There was an error connecting to this message source.  Please check the location and try again.
 messagePassword         = Your credentials were not accepted.  Please check your username and password and try again.
+messageDbBusy           = The Database is temporarily busy.  Please try again after all sources have finished refreshing.
 messageConnected        = Connected.
 messageGettingMessages  = Getting messages...
 messageSuccess          = You have successfully subscribed to this message source.
 messageGenericError     = There was an error completing the subscription to this message source.  Error: %1$S.
 
 title                   = Snowl Preferences
 titleWindows            = Snowl Options
diff --git a/modules/datastore.js b/modules/datastore.js
--- a/modules/datastore.js
+++ b/modules/datastore.js
@@ -915,24 +915,29 @@ let SnowlDatastore = {
    * @param aTimestamp   {real}    the Julian date when the message was sent
    * @param aReceived    {real}    the Julian date when the message was received
    * @param aLink        {string}  a link to the content of the message,
    *                               if the content is hosted on a server
    *
    * @returns {integer} the ID of the newly-created record
    */
   insertMessage: function(aSourceID, aExternalID, aSubject, aAuthorID, aTimestamp, aReceived, aLink) {
-    this._insertMessageStatement.params.sourceID = aSourceID;
-    this._insertMessageStatement.params.externalID = aExternalID;
-    this._insertMessageStatement.params.subject = aSubject;
-    this._insertMessageStatement.params.authorID = aAuthorID;
-    this._insertMessageStatement.params.timestamp = aTimestamp;
-    this._insertMessageStatement.params.received = aReceived;
-    this._insertMessageStatement.params.link = aLink;
-    this._insertMessageStatement.execute();
+    try {
+      this._insertMessageStatement.params.sourceID = aSourceID;
+      this._insertMessageStatement.params.externalID = aExternalID;
+      this._insertMessageStatement.params.subject = aSubject;
+      this._insertMessageStatement.params.authorID = aAuthorID;
+      this._insertMessageStatement.params.timestamp = aTimestamp;
+      this._insertMessageStatement.params.received = aReceived;
+      this._insertMessageStatement.params.link = aLink;
+      this._insertMessageStatement.execute();
+    }
+    finally {
+      this._insertMessageStatement.reset();
+    }
 
     return this.dbConnection.lastInsertRowID;
   },
 
   get _selectIdentitiesSourceIDStatement() {
     let statement = this.createStatement(
       "SELECT sourceID, externalID FROM identities WHERE personID = :id"
     );
diff --git a/modules/feed.js b/modules/feed.js
--- a/modules/feed.js
+++ b/modules/feed.js
@@ -41,17 +41,16 @@ const Ci = Components.interfaces;
 const Cr = Components.results;
 const Cu = Components.utils;
 
 // modules that come with Firefox
 Cu.import("resource://gre/modules/XPCOMUtils.jsm");
 Cu.import("resource://gre/modules/ISO8601DateUtils.jsm");
 
 // modules that are generic
-Cu.import("resource://snowl/modules/log4moz.js");
 Cu.import("resource://snowl/modules/Mixins.js");
 Cu.import("resource://snowl/modules/Observers.js");
 Cu.import("resource://snowl/modules/request.js");
 Cu.import("resource://snowl/modules/URI.js");
 
 // modules that are Snowl-specific
 Cu.import("resource://snowl/modules/constants.js");
 Cu.import("resource://snowl/modules/datastore.js");
@@ -85,21 +84,18 @@ function SnowlFeed(aID, aName, aMachineU
 }
 
 SnowlFeed.prototype = {
   // The constructor property is defined automatically, but we destroy it
   // when we redefine the prototype, so we redefine it here in case we ever
   // need to check it to find out what kind of object an instance is.
   constructor: SnowlFeed,
 
-  // XXX Move this to SnowlSource?
-  get _log() {
-    let logger = Log4Moz.repository.getLogger("Snowl.Feed " + this.name);
-    this.__defineGetter__("_log", function() logger);
-    return this._log;
+  get _logName() {
+    return "Snowl.Feed " + (this.name ? this.name : "<new feed>");
   },
 
   // If we prompt the user to authenticate, and the user asks us to remember
   // their password, we store the nsIAuthInformation in this property until
   // the request succeeds, at which point we store it with the login manager.
   _authInfo: null,
 
   // The nsIFeedResult object generated in the last refresh.
@@ -277,46 +273,47 @@ SnowlFeed.prototype = {
    *        multiple feeds can give their messages the same received time
    */
   refresh: function(time) {
     this._log.trace("start refresh");
 
     if (typeof time == "undefined" || time == null)
       time = new Date();
 
-    // FIXME: remove subscribe from this notification's name.
-    Observers.notify("snowl:subscribe:connect:start", this);
+    Observers.notify("snowl:refresh:connect:start", this);
 
     let request = new Request({
       // The feed processor is going to parse the response, so we override
       // the MIME type in order to turn off parsing by XMLHttpRequest itself.
       overrideMimeType:       "text/plain",
       url:                    this.machineURI,
       // Listen for notification callbacks so we can handle authentication.
       notificationCallbacks:  this
     });
     this._log.info("refresh request finished, status: " + request.status);
 
-    // FIXME: remove subscribe from this notification's name.
-    Observers.notify("snowl:subscribe:connect:end", this, request.status);
+    Observers.notify("snowl:refresh:connect:end", this, request.status);
 
+    this.attributes["statusCode"] = request.status;
     this.lastStatus = request.status + " (" + request.statusText + ")";
     if (request.status < 200 || request.status > 299 || request.responseText.length == 0) {
       this._log.trace("refresh request failed");
       this.onRefreshError();
       return;
     }
     this._log.trace("refresh request succeeded");
 
     // _authInfo only gets set if we prompted the user to authenticate
     // and the user checked the "remember password" box.  Since we're here,
     // it means the request succeeded, so we save the login.
     if (this._authInfo)
       this._saveLogin();
 
+    Observers.notify("snowl:refresh:get:start", this);
+
     // Parse the response.
     // Note: this happens synchronously, even though it uses a listener
     // callback, which makes it look like it happens asynchronously.
     this._log.trace("parsing refresh response");
     let parser = Cc["@mozilla.org/feed-processor;1"].
                  createInstance(Ci.nsIFeedProcessor);
     parser.listener = {
       _self: this,
@@ -363,21 +360,19 @@ SnowlFeed.prototype = {
     // when subscribing to a feed in a local application, so we set it here
     // so it's available for that purpose.
     // ??? Should we also persist and restore it?
     if (feed.subtitle)
       this.subtitle = feed.subtitle.plainText();
     if (!this.humanURI)
       this.humanURI = feed.link;
 
-    // FIXME: remove subscribe from this notification's name.
-    Observers.notify("snowl:subscribe:get:start", this);
     this.messages = this._processFeed(feed, time);
-    // FIXME: remove subscribe from this notification's name.
-    Observers.notify("snowl:subscribe:get:end", this);
+
+    Observers.notify("snowl:refresh:get:end", this);
   },
 
 
   //**************************************************************************//
   // Processing
 
   /**
    * Process a feed into an array of messages.
diff --git a/modules/message.js b/modules/message.js
--- a/modules/message.js
+++ b/modules/message.js
@@ -326,30 +326,35 @@ SnowlMessage.prototype = {
       statement = this._updateMessageStmt;
       statement.params.id = this.id;
     }
     else {
       statement = this._insertMessageStmt;
       statement.params.received = SnowlDateUtils.jsToJulianDate(this.received);
     }
 
-    // Set params that are common to both types of queries.
-    statement.params.sourceID   = this.source.id;
-    statement.params.externalID = this.externalID;
-    statement.params.subject    = this.subject;
-    statement.params.authorID   = this.author ? this.author.id : null;
-    statement.params.timestamp  = SnowlDateUtils.jsToJulianDate(this.timestamp);
-    statement.params.link       = this.link ? this.link.spec : null;
-    // FIXME: persist message.current.
-    //statement.params.current    = this.current;
-    statement.params.read       = this.read;
-    statement.params.headers    = JSON.stringify(this.headers);
-    statement.params.attributes = JSON.stringify(this.attributes);
-
-    statement.execute();
+    try {
+      // Set params that are common to both types of queries.
+      statement.params.sourceID   = this.source.id;
+      statement.params.externalID = this.externalID;
+      statement.params.subject    = this.subject;
+      statement.params.authorID   = this.author ? this.author.id : null;
+      statement.params.timestamp  = SnowlDateUtils.jsToJulianDate(this.timestamp);
+      statement.params.link       = this.link ? this.link.spec : null;
+      // FIXME: persist message.current.
+      //statement.params.current    = this.current;
+      statement.params.read       = this.read;
+      statement.params.headers    = JSON.stringify(this.headers);
+      statement.params.attributes = JSON.stringify(this.attributes);
+  
+      statement.execute();
+    }
+    finally {
+      statement.reset();
+    }
 
     if (this.id) {
       // FIXME: update the message parts (content, summary).
     }
     else {
       added = true;
 
       this.id = SnowlDatastore.dbConnection.lastInsertRowID;
@@ -490,39 +495,45 @@ SnowlMessagePart.prototype = {
     return this._stmtInsertPartText;
   },
 
   persist: function(message) {
     if (this.id) {
       // FIXME: update the existing record as appropriate.
     }
     else {
-      this._stmtInsertPart.params.messageID     = message.id;
-      this._stmtInsertPart.params.partType      = this.partType;
-      this._stmtInsertPart.params.content       = this.content;
-      this._stmtInsertPart.params.mediaType     = this.mediaType;
-      this._stmtInsertPart.params.baseURI       = (this.baseURI ? this.baseURI.spec : null);
-      this._stmtInsertPart.params.languageTag   = this.languageTag;
-      this._stmtInsertPart.execute();
-  
-      this.id = SnowlDatastore.dbConnection.lastInsertRowID;
-  
-      // Insert a plaintext version of the content into the partsText fulltext
-      // table, converting it to plaintext first if necessary (and possible).
-      switch (this.mediaType) {
-        case "text/html":
-        case "application/xhtml+xml":
-        case "text/plain":
-          // Give the fulltext record the same doc ID as the row ID of the parts
-          // record so we can join them together to get the part (and thence the
-          // message) when doing a fulltext search.
-          this._stmtInsertPartText.params.docid = this.id;
-          this._stmtInsertPartText.params.content = this.plainText();
-          this._stmtInsertPartText.execute();
-          break;
-  
-        default:
-          // It isn't a type we understand, so don't do anything with it.
-          // XXX If it's text/*, shouldn't we fulltext index it anyway?
+      try {
+        this._stmtInsertPart.params.messageID     = message.id;
+        this._stmtInsertPart.params.partType      = this.partType;
+        this._stmtInsertPart.params.content       = this.content;
+        this._stmtInsertPart.params.mediaType     = this.mediaType;
+        this._stmtInsertPart.params.baseURI       = (this.baseURI ? this.baseURI.spec : null);
+        this._stmtInsertPart.params.languageTag   = this.languageTag;
+        this._stmtInsertPart.execute();
+    
+        this.id = SnowlDatastore.dbConnection.lastInsertRowID;
+    
+        // Insert a plaintext version of the content into the partsText fulltext
+        // table, converting it to plaintext first if necessary (and possible).
+        switch (this.mediaType) {
+          case "text/html":
+          case "application/xhtml+xml":
+          case "text/plain":
+            // Give the fulltext record the same doc ID as the row ID of the parts
+            // record so we can join them together to get the part (and thence the
+            // message) when doing a fulltext search.
+            this._stmtInsertPartText.params.docid = this.id;
+            this._stmtInsertPartText.params.content = this.plainText();
+            this._stmtInsertPartText.execute();
+            break;
+    
+          default:
+            // It isn't a type we understand, so don't do anything with it.
+            // XXX If it's text/*, shouldn't we fulltext index it anyway?
+        }
+      }
+      finally {
+        this._stmtInsertPart.reset();
+        this._stmtInsertPartText.reset();
       }
     }
   }
 };
diff --git a/modules/service.js b/modules/service.js
--- a/modules/service.js
+++ b/modules/service.js
@@ -280,64 +280,81 @@ let SnowlService = {
       return;
     }
 
     this._log.info("refreshing stale sources");
 
     let now = new Date();
     let staleSources = [];
     for each (let source in this.sources)
-      if (now - source.lastRefreshed > source.refreshInterval)
+      if (now - source.lastRefreshed > source.refreshInterval &&
+          !this.sourcesByID[source.id].busy &&
+          source.attributes["refreshStatus"] != "disabled")
+        // Do not autorefresh (as opposed to user initiated refresh) if a source
+        // is permanently disabled (404 error eg); do not refresh busy source.
         staleSources.push(source);
     this.refreshAllSources(staleSources);
   },
 
+  get refreshingCount() {
+    return this._refreshingCount ? this._refreshingCount : this._refreshingCount = 0;
+  },
+  
+  set refreshingCount(val) {
+    return this._refreshingCount = val;
+  },
+
   refreshAllSources: function(sources) {
+    let cachedsource;
     let allSources = sources ? sources : this.sources;
 
-    // Set busy property, notify observer to invalidate tree.
+    // Set busy property.
     for each (let source in allSources) {
-      this.sourcesByID[source.id].busy = true;
-      this.sourcesByID[source.id].error = false;
+      cachedsource = this.sourcesByID[source.id];
+      if (cachedsource) {
+        cachedsource.busy = true;
+        cachedsource.error = false;
+        cachedsource.attributes["refreshStatus"] = "active";
+      }
+      this.refreshingCount = ++this.refreshingCount;
     }
 
-    if (allSources.length > 0) {
-      // TODO: Don't set busy on 'all' until we know when the last one is done
-      // so it can be unset.
-//      this._collectionStatsByCollectionID["all"].busy = true;
-
-      // Invalidate tree to show new state.
+    if (allSources.length > 0)
+      // Invalidate collections tree to show new state.
       Observers.notify("snowl:messages:completed", "refresh");
-    }
 
     // We specify the same refresh time when refreshing sources so that all
     // new messages have the same received time, which makes messages sorted by
     // received, then published times look better (more mixed together by
     // publication time, not clumped up by source based on the received time)
     // when retrieved in the same refresh (f.e. when the user starts their
     // browser in the morning after leaving it off overnight).
     let refreshTime = new Date();
-    for each (let source in allSources) {
-this._log.info("refreshStaleSources: refreshInterval - "+source.refreshInterval);
+    for each (let source in allSources)
       this.refreshSourceTimer(source, refreshTime);
-    }
   },
 
   refreshSourceTimer: function(aSource, aRefreshTime) {
     let timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
     let callback = { notify: function(aTimer) {
       SnowlService._log.info("Refreshing source: " +
           aSource.name + " - " + aSource.machineURI.spec);
       try {
         aSource.refresh(aRefreshTime);
+      }
+      catch(ex) {
+        aSource.lastStatus = ex;
+        aSource.onRefreshError();
+      }
+      try {
         aSource.persist(true);
       }
       catch(ex) {
         aSource.lastStatus = ex;
-        aSource.onRefreshError();
+        aSource.onDbError();
       }
     } };
 
     timer.initWithCallback(callback, 10, Ci.nsITimer.TYPE_ONE_SHOT);
   },
 
   /**
    * Determine whether or not the datastore contains the message with the given ID.
diff --git a/modules/source.js b/modules/source.js
--- a/modules/source.js
+++ b/modules/source.js
@@ -37,16 +37,17 @@
 let EXPORTED_SYMBOLS = ["SnowlSource"];
 
 const Cc = Components.classes;
 const Ci = Components.interfaces;
 const Cr = Components.results;
 const Cu = Components.utils;
 
 // modules that are generic
+Cu.import("resource://snowl/modules/log4moz.js");
 Cu.import("resource://snowl/modules/Observers.js");
 Cu.import("resource://snowl/modules/Sync.js");
 Cu.import("resource://snowl/modules/URI.js");
 
 // modules that are Snowl-specific
 Cu.import("resource://snowl/modules/constants.js");
 Cu.import("resource://snowl/modules/datastore.js");
 Cu.import("resource://snowl/modules/message.js");
@@ -187,17 +188,23 @@ SnowlSource.prototype = {
     this.machineURI = aMachineURI;
     this.humanURI = aHumanURI;
     this.username = aUsername;
     this.lastRefreshed = aLastRefreshed;
     // FIXME: make it so I don't have to set importance to null if it isn't
     // specified in order for its non-set value to remain null.
     this.importance = aImportance || null;
     this.placeID = aPlaceID;
-    this.attributes = aAttributes;
+    this.attributes = aAttributes || new Object;
+  },
+
+  get _log() {
+    let logger = Log4Moz.repository.getLogger(this._logName);
+    this.__defineGetter__("_log", function() logger);
+    return this._log;
   },
 
   // For adding isBusy property to collections tree.
   busy: false,
 
   // For adding hasError property to collections tree, status message.
   error: false,
   lastStatus: null,
@@ -309,22 +316,45 @@ SnowlSource.prototype = {
    *          across refreshes of multiple sources, which makes message views
    *          sorted by received, then published look better for messages
    *          received in the same refresh cycle.
    */
   refresh: function(refreshTime) {},
 
   onRefreshError: function() {
     this.error = true;
+    if (this.attributes["statusCode"] = 404) {
+      this.attributes["refreshStatus"] = "disabled";
+      SnowlService.sourcesByID[this.id].attributes["refreshStatus"] = "disabled";
+    }
+
+    this._log.error("Refresh error: " + this.lastStatus);
+  },
+
+  onDbCompleted: function() {
+    // Database source record updated, set notifications and states.
     if (this.id) {
       // Only for existing stored sources; notify refreshes collections tree state.
-      SnowlService.sourcesByID[this.id].error = true;
+      SnowlService.sourcesByID[this.id].busy = false;
+      SnowlService.sourcesByID[this.id].error = this.error;
+      SnowlService.refreshingCount = --SnowlService.refreshingCount;
+    }
+    Observers.notify("snowl:messages:completed", this.id);
+  },
+
+  onDbError: function() {
+    this.error = true;
+    if (this.id) {
+      // Only for existing stored sources; notify refreshes collections tree state.
+      SnowlService.sourcesByID[this.id].busy = false;
+      SnowlService.sourcesByID[this.id].error = this.error;
+      SnowlService.refreshingCount = --SnowlService.refreshingCount;
       Observers.notify("snowl:messages:completed", this.id);
     }
-    this._log.error("Refresh error: " + this.lastStatus);
+    this._log.error("Database error: " + this.lastStatus);
   },
 
   retrieveMessages: function() {
     // FIXME: memoize this.
     let messagesStatement = SnowlDatastore.createStatement(
       "SELECT id FROM messages WHERE sourceID = :id"
     );
     
@@ -357,42 +387,68 @@ SnowlSource.prototype = {
       statement = SnowlDatastore.createStatement(
         "UPDATE sources " +
         "SET      name = :name,          " +
         "         type = :type,          " +
         "   machineURI = :machineURI,    " +
         "     humanURI = :humanURI,      " +
         "     username = :username,      " +
         "lastRefreshed = :lastRefreshed, " +
-        "   importance = :importance     " +
-        "WHERE     id = :id"
+        "   importance = :importance,    " +
+        "   attributes = :attributes     " +
+        "WHERE      id = :id"
       );
     }
     else {
       statement = SnowlDatastore.createStatement(
-        "INSERT INTO sources ( name,  type,  machineURI,  humanURI,  username,  lastRefreshed,  importance) " +
-        "VALUES              (:name, :type, :machineURI, :humanURI, :username, :lastRefreshed, :importance)"
+        "INSERT INTO sources ( name,  type,  machineURI,  humanURI,  username, " +
+        "                      lastRefreshed,  importance, attributes) " +
+        "VALUES              ( :name, :type, :machineURI, :humanURI, :username, " +
+        "                      :lastRefreshed, :importance, :attributes)"
       );
     }
 
+    // Need to get a transaction lock.
+    if (SnowlDatastore.dbConnection.transactionInProgress) {
+      this.attributes["statusCode"] = "db:transactionInProgress";
+      this.lastStatus = "Database temporarily busy, could not get transaction lock";
+      if (this.id) {
+        // Only for existing stored sources; notify refreshes collections tree state.
+        SnowlService.sourcesByID[this.id].busy = false;
+        SnowlService.sourcesByID[this.id].error = this.error;
+        SnowlService.refreshingCount = --SnowlService.refreshingCount;
+//        Observers.notify("snowl:messages:completed", this.id);
+      }
+      else {
+        // New subscriptions need to return feedback.
+        this.error = true;
+        this._log.info("persist: " + this.lastStatus);
+      }
+
+      return;
+    }
+
     SnowlDatastore.dbConnection.beginTransaction();
     try {
       statement.params.name = this.name;
       statement.params.type = this.constructor.name;
       statement.params.machineURI = this.machineURI.spec;
       statement.params.humanURI = this.humanURI ? this.humanURI.spec : null;
       statement.params.username = this.username;
       statement.params.lastRefreshed = this.lastRefreshed ? SnowlDateUtils.jsToJulianDate(this.lastRefreshed) : null;
       statement.params.importance = this.importance;
+      statement.params.attributes = JSON.stringify(this.attributes);
       if (this.id)
         statement.params.id = this.id;
       statement.step();
       if (!this.id) {
         // Extract the ID of the source from the newly-created database record.
         this.id = SnowlDatastore.dbConnection.lastInsertRowID;
+        // New source, bump refreshing count.
+        SnowlService.refreshingCount = ++SnowlService.refreshingCount;
 
         // Update message authors to include the source ID.
         // FIXME: make SnowlIdentity records have a source property
         // referencing a source object rather than a sourceID property
         // referencing a source object's ID.
         if (this.messages)
           for each (let message in this.messages)
             if (message.author)
@@ -460,28 +516,27 @@ this._log.info("persist placeID:sources.
         }
 
         // Update the current flag.
         this.updateCurrentMessages(currentMessageIDs);
 
         if (messagesChanged)
           // Invalidate stats cache on completion of refresh with new messages.
           SnowlService._collectionStatsByCollectionID = null;
-
-        // Notify collections view on completion of refresh.
-        SnowlService.sourcesByID[this.id].busy = false;
-        Observers.notify("snowl:messages:completed", this.id);
       }
 
       SnowlDatastore.dbConnection.commitTransaction();
+
+      // Source successfully stored/updated.
+      this.onDbCompleted();
     }
     catch(ex) {
       SnowlDatastore.dbConnection.rollbackTransaction();
       this.lastStatus = ex;
-      this.onRefreshError();
+      this.onDbError();
     }
     finally {
       statement.reset();
     }
 
     return this.id;
   },
 
diff --git a/modules/twitter.js b/modules/twitter.js
--- a/modules/twitter.js
+++ b/modules/twitter.js
@@ -41,17 +41,16 @@ const Ci = Components.interfaces;
 const Cr = Components.results;
 const Cu = Components.utils;
 
 // modules that come with Firefox
 Cu.import("resource://gre/modules/XPCOMUtils.jsm");
 Cu.import("resource://gre/modules/ISO8601DateUtils.jsm");
 
 // modules that are generic
-Cu.import("resource://snowl/modules/log4moz.js");
 Cu.import("resource://snowl/modules/Mixins.js");
 Cu.import("resource://snowl/modules/Observers.js");
 Cu.import("resource://snowl/modules/request.js");
 Cu.import("resource://snowl/modules/URI.js");
 
 // modules that are Snowl-specific
 Cu.import("resource://snowl/modules/constants.js");
 Cu.import("resource://snowl/modules/datastore.js");
@@ -137,20 +136,18 @@ function SnowlTwitter(aID, aName, aMachi
 }
 
 SnowlTwitter.prototype = {
   // The constructor property is defined automatically, but we destroy it
   // when we redefine the prototype, so we redefine it here in case we ever
   // need to check it to find out what kind of object an instance is.
   constructor: SnowlTwitter,
 
-  get _log() {
-    let logger = Log4Moz.repository.getLogger("Snowl.Twitter." + this.username);
-    this.__defineGetter__("_log", function() logger);
-    return this._log;
+  get _logName() {
+    return "Snowl.Twitter." + this.username;
   },
 
 
   //**************************************************************************//
   // Abstract Class Composition Declarations
 
   _classes: [SnowlSource, SnowlTarget],
 
@@ -336,17 +333,17 @@ SnowlTwitter.prototype = {
    *        messages; we let the caller specify this so a caller refreshing
    *        multiple feeds can give their messages the same received time
    */
   refresh: function(time) {
     if (typeof time == "undefined" || time == null)
       time = new Date();
 //    this._log.info("start refresh " + this.username + " at " + time);
 
-    Observers.notify("snowl:subscribe:get:start", this);
+    Observers.notify("snowl:refresh:connect:start", this);
 
     // URL parameters that modify the return value of the request.
     let params = [];
 
     // Retrieve up to 200 messages, the maximum we're allowed to retrieve.
     params.push("count=200");
 
     // Retrieve only messages newer than the most recent one already retrieved.
@@ -371,39 +368,41 @@ SnowlTwitter.prototype = {
     }
 
     let request = new Request({
       url: url,
       notificationCallbacks: this,
       requestHeaders: requestHeaders
     });
 
-    // FIXME: remove subscribe from this notification's name.
-    Observers.notify("snowl:subscribe:connect:end", this, request.status);
+    Observers.notify("snowl:refresh:connect:end", this, request.status);
 
+    this.attributes["statusCode"] = request.status;
     this.lastStatus = request.status + " (" + request.statusText + ")";
     if (request.status < 200 || request.status > 299 || request.responseText.length == 0) {
       this.onRefreshError();
       return;
     }
 
     // _authInfo only gets set if we prompted the user to authenticate
     // and the user checked the "remember password" box.  Since we're here,
     // it means the request succeeded, so we save the login.
     if (this._authInfo) {
       this._saveLogin(this._authInfo);
       this._authInfo = null;
     }
 
+    Observers.notify("snowl:refresh:get:start", this);
+
     let items = JSON.parse(request.responseText);
     this.messages = this._processItems(items, time);
 
     this.lastRefreshed = time;
 
-    Observers.notify("snowl:subscribe:get:end", this);
+    Observers.notify("snowl:refresh:get:end", this);
   },
 
 
   //**************************************************************************//
   // Processing
 
   /**
    * Process an array of items (from the server) into an array of messages.
