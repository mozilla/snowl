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

const EXPORTED_SYMBOLS = ["SnowlSource"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/URI.js");
Cu.import("resource://snowl/modules/utils.js");

function SnowlSource(aID, aName, aMachineURI, aHumanURI, aLastRefreshed, aImportance) {
  this.id = aID;
  this.name = aName;
  this.machineURI = aMachineURI;
  this.humanURI = aHumanURI;
  this._lastRefreshed = aLastRefreshed;
  this.importance = aImportance;
}

SnowlSource.__defineGetter__("_getStatement",
  function() {
    let statement = SnowlDatastore.createStatement(
      "SELECT name, machineURI, humanURI, lastRefreshed, importance " +
      "FROM sources WHERE id = :id"
    );
    this.__defineGetter__("_getStatement", function() { return statement });
    return this._getStatement;
  }
);

/**
 * Get the SnowlSource identified by the given identifier.
 *
 * FIXME: cache instances and return the cached instance if available.
 */
SnowlSource.get = function(aID) {
  try {
    this._getStatement.params.id = aID;
    if (this._getStatement.step())
      return new SnowlSource(aID,
                             this._getStatement.row.name,
                             URI.get(this._getStatement.row.machineURI),
                             URI.get(this._getStatement.row.humanURI),
                             SnowlUtils.julianToJSDate(this._getStatement.row.lastRefreshed),
                             this._getStatement.row.importance);
  }
  finally {
    this._getStatement.reset();
  }

  return null;
}

// Favicon Service
SnowlSource.__defineGetter__("faviconSvc",
  function() {
    let faviconSvc = Cc["@mozilla.org/browser/favicon-service;1"].
                     getService(Ci.nsIFaviconService);
    delete this.faviconSvc;
    this.faviconSvc = faviconSvc;
    return this.faviconSvc;
  }
);

SnowlSource.prototype = {
  // How often to refresh sources, in milliseconds.
  refreshInterval: 1000 * 60 * 30, // 30 minutes

  id: null,

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
    stmt.params.lastRefreshed = SnowlUtils.jsToJulianDate(this._lastRefreshed);
    stmt.params.id = this.id;
    stmt.execute();
  },

  // An integer representing how important this source is to the user
  // relative to other sources to which the user is subscribed.
  importance: null,

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
