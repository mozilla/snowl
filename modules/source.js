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

let EXPORTED_SYMBOLS = ["SnowlSource"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

// modules that are generic
Cu.import("resource://snowl/modules/URI.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/utils.js");

/**
 * SnowlSource: a source of messages.
 * 
 * This is an abstract class that should not be instantiated. Rather, objects
 * should inherit it via one of two methods (depending on whether or not they
 * also inherit other functionality):
 *
 * Objects that only inherit SnowlSource may assign it to their prototype
 * (or to their prototype's prototype) and then declare overridden attributes
 * as appropriate, with the prototype chain automatically delegating other
 * attributes to SnowlSource:
 *
 *   function MySource = {
 *     SnowlSource.init.call(this, ...);
 *     this.overriddenMethod: function(...) {...},
 *     this.overriddenProperty: "foo",
 *     this.__defineGetter("overriddenGetter", function() {...}),
 *     this.__defineSetter("overriddenSetter", function(newVal) {...}),
 *   }
 *   MySource.prototype = SnowlSource;
 *
 *     -- or --
 *
 *   function MySource = {
 *     SnowlSource.init.call(this, ...);
 *   }
 *   MySource.prototype = {
 *     __proto__: SnowlSource,
 *     overriddenMethod: function(...) {...},
 *     overriddenProperty: "foo",
 *     get overriddenGetter() {...},
 *     set overriddenSetter(newVal) {...}
 *   };
 *
 * Objects that inherit other functionality should redeclare every attribute
 * in SnowlSource, manually delegating to SnowlSource as appropriate:
 *
 *   function MyThing = {
 *     SnowlSource.init.call(this, ...);
 *   }
 *
 *   MyThing.prototype = {
 *     overriddenMethod: function(...) {...},
 *     overriddenProperty: "foo",
 *     get overriddenGetter() {...},
 *     set overriddenSetter(newVal) {...}
 *
 *     delegatedMethod: function(...) {
 *       SnowlSource.call(this, ...);
 *     },
 *
 *     get delegatedProperty: function() {
 *       return SnowlSource.delegatedProperty;
 *     },
 *
 *     // It's dangerous to set the base class's properties; don't do this!!!
 *     set delegatedProperty: function(newVal) {
 *       SnowlSource.delegatedProperty = newVal;
 *     },
 *
 *     get delegatedGetter: function() {
 *       return SnowlSource.__lookupGetter__("delegatedGetter").call(this);
 *     },
 *
 *     set delegatedSetter: function(newVal) {
 *       SnowlSource.__lookupSetter__("delegatedSetter").call(this, newVal);
 *     }
 *   };
 */
let SnowlSource = {
  init: function(aID, aType, aName, aMachineURI, aHumanURI, aLastRefreshed, aImportance) {
    this.id = aID;
    this.type = aType;
    this.name = aName;
    this.machineURI = aMachineURI;
    this.humanURI = aHumanURI;
    this._lastRefreshed = aLastRefreshed;
    this.importance = aImportance;
  },

  // How often to refresh sources, in milliseconds.
  refreshInterval: 1000 * 60 * 30, // 30 minutes

  id: null,

  type: null,

  name: null,

  // The URL at which to find a machine-processable representation of the data
  // provided by the source.  For a feed source, this is the URL of its RSS/Atom
  // document; for an email source, it's the URL of its POP/IMAP server.
  machineURI: null,

  // The URL at which to find a human-readable representation of the data
  // provided by the source.  For a feed source, this is the website that
  // publishes the feed; for an email source, it might be the webmail interface.
  humanURI: null,

  // A JavaScript Date object representing the last time this source
  // was checked for updates to its set of messages.
  _lastRefreshed: null,

  get lastRefreshed() {
    return this._lastRefreshed;
  },

  set lastRefreshed(newValue) {
    this._lastRefreshed = newValue;

    let stmt = SnowlDatastore.createStatement("UPDATE sources " +
                                              "SET lastRefreshed = :lastRefreshed " +
                                              "WHERE id = :id");
    stmt.params.lastRefreshed = SnowlDateUtils.jsToJulianDate(this._lastRefreshed);
    stmt.params.id = this.id;
    stmt.execute();
  },

  // An integer representing how important this source is to the user
  // relative to other sources to which the user is subscribed.
  importance: null,

  // Favicon Service
  get faviconSvc() {
    delete this.faviconSvc;
    return this.faviconSvc = Cc["@mozilla.org/browser/favicon-service;1"].
                             getService(Ci.nsIFaviconService);
  },

  get faviconURI() {
    if (this.humanURI) {
      try {
        return SnowlSource.faviconSvc.getFaviconForPage(this.humanURI);
      }
      catch(ex) { /* no known favicon; use the default */ }
    }

    // The default favicon for feed sources.
    // FIXME: once we support other types of sources, override this
    // with a type-specific icon.
    return URI.get("chrome://browser/skin/feeds/feedIcon16.png");
  },

  /**
   * Check for new messages and update the local store of messages to reflect
   * the latest updates available from the source.  This method is a stub that
   * is expected to be overridden by subclass implementations.
   */
  refresh: function() {},

  persist: function() {
    let statement =
      SnowlDatastore.createStatement(
        "INSERT INTO sources (name, type, machineURI, humanURI) " +
        "VALUES (:name, :type, :machineURI, :humanURI)"
      );

    try {
      statement.params.name = this.name;
      statement.params.type = this.constructor.name;
      statement.params.machineURI = this.machineURI.spec;
      statement.params.humanURI = this.humanURI.spec;
      statement.step();
    }
    finally {
      statement.reset();
    }

    // Extract the ID of the source from the newly-created database record.
    this.id = SnowlDatastore.dbConnection.lastInsertRowID;
  }

};
