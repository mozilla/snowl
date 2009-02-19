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

let EXPORTED_SYMBOLS = ["SnowlDatastore", "SnowlPlaces", "SnowlQuery"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

// modules that come with Firefox
Cu.import("resource://gre/modules/utils.js"); // Places
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

// modules that are generic
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/StringBundle.js");
Cu.import("resource://snowl/modules/URI.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/constants.js");

let strings = new StringBundle("chrome://snowl/locale/datastore.properties");

const TABLE_TYPE_NORMAL = 0;
const TABLE_TYPE_FULLTEXT = 1;

let SnowlDatastore = {
  // FIXME: use the memoization technique for properties that aren't defined
  // in the prototype here instead of the technique for properties that are
  // defined in the prototype.
  get _storage() {
    var storage = Cc["@mozilla.org/storage/service;1"].
                  getService(Ci.mozIStorageService);
    this.__defineGetter__("_storage", function() { return storage });
    return this._storage;
  },

  //**************************************************************************//
  // Database Creation & Access

  _dbVersion: 12,

  _dbSchema: {
    // Note: datetime values like messages:timestamp are stored as Julian dates.

    // FIXME: establish a universalID property of messages that is unique
    // across sources for cases in which multiple sources provide the same
    // message, they identify it via an ID that is unique across sources,
    // and we don't want to duplicate the message.

    // FIXME: make the datastore support multiple authors.

    // FIXME: support labeling the subject as HTML or another content type.

    // FIXME: define TABLE_TYPE_FULLTEXT tables in a separate fulltextTables
    // property and create them via a separate _dbCreateFulltextTables function
    // just as we define indexes in a separate indexes property and create them
    // via a separate _dbCreateIndexes function.

    // FIXME: make the tables property an array of tables just as the indexes
    // property is an array of indexes so we can create them in a specific order
    // that respects their (currently only advisory) foreign key constraints.
    
    // FIXME: make columns be objects with name, type, & constraint properties.

    tables: {
      sources: {
        type: TABLE_TYPE_NORMAL,
        columns: [
          "id INTEGER PRIMARY KEY",
          "type TEXT NOT NULL",
          "name TEXT NOT NULL",
          // XXX Call these URL instead of URI, since they are unambiguously
          // locations, not names (and thus never URNs)?
          "machineURI TEXT NOT NULL",
          "humanURI TEXT",
          "username TEXT",
          "lastRefreshed REAL",
          "importance INTEGER",
          "placeID INTEGER"
        ]
      },

      messages: {
        type: TABLE_TYPE_NORMAL,
        columns: [
          "id INTEGER PRIMARY KEY",
          "sourceID INTEGER NOT NULL REFERENCES sources(id)",

          // externalID is a unique identifier provided by the source
          // of the message which is constant across message transfer points
          // and destinations.  For feeds, it's the entry ID; for email,
          // it's the message ID; for tweets, it's the tweet ID.
          //
          // externalID is a BLOB because some sources (like Twitter) give
          // messages integer IDs, and if it were TEXT, then we'd have to
          // CAST(externalID AS INTEGER) to get it as an integer in order to
          // do things like get the MAX(externalID) for a given Twitter source
          // so we can retrieve only messages since_id=<the max ID>.
          "externalID BLOB",

          "subject TEXT",
          "authorID INTEGER REFERENCES people(id)",

          // timestamp represents the date/time assigned to the message by its
          // source.  It can have multiple meanings, including when the message
          // was "sent" by its author, when it was published, and when it was
          // last updated.
          "timestamp REAL",

          // received represents the date/time at which the message was first
          // received by this application.
          "received REAL",

          "link TEXT",
          "current BOOLEAN DEFAULT 1",
          "read BOOLEAN DEFAULT 0"
        ]
      },

      parts: {
        type: TABLE_TYPE_NORMAL,
        columns: [
          "id INTEGER PRIMARY KEY",
          "messageID INTEGER NOT NULL REFERENCES messages(id)",
          "content NOT NULL",
          // The DEFAULT constraint helps when upgrading from schemas
          // that didn't require mediaType to be NOT NULL, so it might
          // have contained NULL values.
          "mediaType TEXT NOT NULL DEFAULT 'application/octet-stream'",
          "partType INTEGER NOT NULL",
          "baseURI TEXT",
          "languageTag TEXT"
        ]
      },

      partsText: {
        type: TABLE_TYPE_FULLTEXT,
        columns: [
          // partsText has an implicit docid column whose value we set to the ID
          // of the corresponding record in the parts table so we can join them
          // to get the part (and thence message) for a fulltext search result.
          "content"
        ]
      },

      attributes: {
        type: TABLE_TYPE_NORMAL,
        columns: [
          "id INTEGER PRIMARY KEY",
          "namespace TEXT",
          "name TEXT NOT NULL"
        ]
      },

      // FIXME: call this messageMetadata, since we have one for people, too
      // (and might get one for sources in the future).
      // XXX Should we call this "properties"?
      metadata: {
        type: TABLE_TYPE_FULLTEXT,
        columns: [
          "messageID INTEGER NOT NULL REFERENCES messages(id)",
          "attributeID INTEGER NOT NULL REFERENCES attributes(id)",
          "contentType TEXT NOT NULL",
          "value BLOB"
        ]
      },

      people: {
        type: TABLE_TYPE_NORMAL,
        columns: [
          "id INTEGER PRIMARY KEY",
          // XXX Should we store this info as part of the identity, so that
          // a person with multiple identities could retain information from
          // all of them and select from it at display time?
          "name TEXT NOT NULL",
          "homeURL TEXT",
          "iconURL TEXT",
          "placeID INTEGER"
        ]
      },

      personMetadata: {
        type: TABLE_TYPE_NORMAL,
        columns: [
          "personID INTEGER NOT NULL REFERENCES people(id)",
          "attributeID INTEGER NOT NULL REFERENCES attributes(id)",
          "value BLOB"
        ]
      },

      identities: {
        type: TABLE_TYPE_NORMAL,
        columns: [
          "id INTEGER PRIMARY KEY",
          "sourceID INTEGER NOT NULL REFERENCES sources(id)",
          "externalID TEXT NOT NULL",
          "personID INTEGER NOT NULL REFERENCES people(id)",
          "UNIQUE(externalID, sourceID)"
        ]
      },

      collections: {
        type: TABLE_TYPE_NORMAL,
        columns: [
          "id INTEGER PRIMARY KEY",
          "name TEXT NOT NULL",
          "iconURL TEXT",
          "orderKey INTEGER NOT NULL DEFAULT 0",
          "grouped BOOLEAN DEFAULT 0",
          "groupIDColumn TEXT",
          "groupNameColumn TEXT",
          "groupHomeURLColumn TEXT",
          "groupIconURLColumn TEXT"
        ]
      }
    },

    indexes: [
      // Index the sourceID and externalID columns in the messages table
      // to speed up checking if a message we're receiving from a source
      // is already in the datastore.
      {
           name:  "messages_sourceID_externalID",
          table:  "messages",
        columns:  ["sourceID", "externalID"]
      },

      // Index the messageID column in the parts table to speed up retrieval
      // of content for a specific message, which we do a lot.
      {
           name:  "parts_messageID",
          table:  "parts",
        columns:  ["messageID"]
      }
    ]

  },

  _defaultCollections: [
    { name:               strings.get("allCollectionName"),
      iconURL:            "chrome://snowl/content/icons/rainbow.png",
      orderKey:           1,
      grouped:            false },

    { name:               strings.get("sourcesCollectionName"),
      iconURL:            "chrome://snowl/skin/livemarkFolder-16.png",
      orderKey:           2,
      grouped:            true,
      groupIDColumn:      "sources.id",
      groupNameColumn:    "sources.name",
      groupHomeURLColumn: "sources.humanURI" },

    { name:               strings.get("authorsCollectionName"),
      iconURL:            "chrome://snowl/skin/person-16.png",
      orderKey:           3,
      grouped:            true,
      groupIDColumn:      "authors.id",
      groupNameColumn:    "authors.name",
      groupIconURLColumn: "authors.iconURL" }
  ],

  dbConnection: null,

  createStatement: function(aSQLString, aDBConnection) {
    let dbConnection = aDBConnection ? aDBConnection : this.dbConnection;

    try {
      var statement = dbConnection.createStatement(aSQLString);
    }
    catch(ex) {
      throw("error creating statement " + aSQLString + " - " +
            dbConnection.lastError + ": " +
            dbConnection.lastErrorString + " - " + ex);
    }

    var wrappedStatement = new InstrumentedStorageStatement(aSQLString);
    wrappedStatement.initialize(statement);
    return wrappedStatement;
  },

  // _dbInit, the methods it calls (_dbCreateTables, _dbMigrate), and methods
  // those methods call must be careful not to call any method of the service
  // that assumes the database connection has already been initialized,
  // since it won't be initialized until this function returns.

  _dbInit: function() {
    var dirService = Cc["@mozilla.org/file/directory_service;1"].
                     getService(Ci.nsIProperties);
    var dbFile = dirService.get("ProfD", Ci.nsIFile);
    dbFile.append("messages.sqlite");

    var dbService = Cc["@mozilla.org/storage/service;1"].
                    getService(Ci.mozIStorageService);

    var dbConnection;

    if (!dbFile.exists()) {
      dbConnection = dbService.openUnsharedDatabase(dbFile);
      this._dbCreate(dbConnection);
    }
    else {
      try {
        dbConnection = dbService.openUnsharedDatabase(dbFile);

        // Get the version of the database in the file.
        var version = dbConnection.schemaVersion;

        if (version != this._dbVersion)
          this._dbMigrate(dbConnection, version, this._dbVersion);
      }
      catch (ex) {
        // If the database file is corrupted, I'm not sure whether we should
        // just delete the corrupted file or back it up.  For now I'm just
        // deleting it, but here's some code that backs it up (but doesn't limit
        // the number of backups, which is probably necessary, thus I'm not
        // using this code):
        //var backup = this._dbFile.clone();
        //backup.createUnique(Ci.nsIFile.NORMAL_FILE_TYPE, PERMS_FILE);
        //backup.remove(false);
        //this._dbFile.moveTo(null, backup.leafName);
        if (ex.result == Cr.NS_ERROR_FILE_CORRUPTED) {
          // Remove the corrupted file, then recreate it.
          dbFile.remove(false);
          dbConnection = dbService.openUnsharedDatabase(dbFile);
          this._dbCreate(dbConnection);
        }
        else
          throw ex;
      }
    }

    this.dbConnection = dbConnection;
  },

  _dbCreate: function(dbConnection) {
    dbConnection.beginTransaction();
    try {
      this._dbCreateTables(dbConnection);
      this._dbCreateIndexes(dbConnection);
      dbConnection.schemaVersion = this._dbVersion;
      this._dbInsertDefaultData(dbConnection);
      dbConnection.commitTransaction();
    }
    catch(ex) {
      dbConnection.rollbackTransaction();
      throw ex;
    }
  },

  _dbCreateTables: function(aDBConnection) {
    for (let tableName in this._dbSchema.tables) {
      let table = this._dbSchema.tables[tableName];
      this._dbCreateTable(aDBConnection, tableName, table);
    }
  },

  _dbCreateTable: function(aDBConnection, tableName, table) {
    switch (table.type) {
      case TABLE_TYPE_FULLTEXT:
        aDBConnection.executeSimpleSQL(
          "CREATE VIRTUAL TABLE " + tableName +
          " USING fts3(" + table.columns.join(", ") + ")"
        );
        break;

      case TABLE_TYPE_NORMAL:
      default:
        aDBConnection.createTable(tableName, table.columns.join(", "));
        break;
    }
  },

  _dbCreateIndexes: function(dbConnection) {
    for each (let index in this._dbSchema.indexes)
      this._dbCreateIndex(dbConnection, index);
  },

  _dbCreateIndex: function(dbConnection, index) {
    dbConnection.executeSimpleSQL(
      "CREATE INDEX " + index.name + " ON " + index.table +
      "(" + index.columns.join(", ") + ")"
    );
  },

  _dbInsertDefaultData: function(aDBConnection) {
    let params = ["name", "iconURL", "orderKey", "grouped", "groupIDColumn",
                  "groupNameColumn", "groupHomeURLColumn",
                  "groupIconURLColumn"];

    let statement = this.createStatement(
      "INSERT INTO collections (" + params.join(", ") + ") " +
      "VALUES (" + params.map(function(v) ":" + v).join(", ") + ")",
      aDBConnection);

    for each (let collection in this._defaultCollections) {
      for each (let param in params)
        statement.params[param] = (param in collection) ? collection[param] : null;
      statement.execute();
    }
  },

  /**
   * Migrate the database schema from one version to another.  Calls out to
   * version pair specific migrator functions below.  Handles migrations from
   * all older to newer versions of Snowl per this Snowl to DB version map:
   *   0.1      : 4
   *   0.1.1    : 4
   *   0.2pre1  : 5
   *   0.2pre2  : 5
   *   0.2pre3  : 8
   *   0.2pre3.1: 8
   *
   * Also handles migrations from each version to the next higher one for folks
   * tracking development releases or the repository.  And might handle migrations
   * between other version pairs on occasion as warranted.
   *
   * FIXME: do multi-version upgrades automatically if it's possible to get to
   * the latest version via a series of steps instead of writing one-off
   * functions to do the database migration for every combination of versions.
   */
  _dbMigrate: function(aDBConnection, aOldVersion, aNewVersion) {
    if (this["_dbMigrate" + aOldVersion + "To" + aNewVersion]) {
      aDBConnection.beginTransaction();
      try {
        this["_dbMigrate" + aOldVersion + "To" + aNewVersion](aDBConnection);
        aDBConnection.schemaVersion = aNewVersion;
        aDBConnection.commitTransaction();
      }
      catch(ex) {
        aDBConnection.rollbackTransaction();
        throw ex;
      }
    }
    else
      throw("can't migrate database from v" + aOldVersion +
            " to v" + aNewVersion + ": no migrator function");
  },

  /**
   * Migrate the database schema from version 0 to the current version.
   * 
   * We never create a database with version 0, so the database can only
   * have that version if the database file was created without the schema
   * being constructed (f.e. because the disk was out of space and let us
   * create the file but not populate it with any data).  Thus, migrating
   * the database is as simple as constructing the schema from scratch.
   *
   * FIXME: special case the calling of this function so we don't have to
   * rename it every time we increase the schema version.
   */
  _dbMigrate0To12: function(dbConnection) {
    this._dbCreate(dbConnection);
  },

  _dbMigrate4To12: function(dbConnection) {
    this._dbMigrate4To5(dbConnection);
    this._dbMigrate5To6(dbConnection);
    this._dbMigrate6To7(dbConnection);
    this._dbMigrate7To8(dbConnection);
    this._dbMigrate8To9(dbConnection);
    this._dbMigrate9To10(dbConnection);
    this._dbMigrate10To11(dbConnection);
    this._dbMigrate11To12(dbConnection);
  },

  _dbMigrate5To12: function(dbConnection) {
    this._dbMigrate5To6(dbConnection);
    this._dbMigrate6To7(dbConnection);
    this._dbMigrate7To8(dbConnection);
    this._dbMigrate8To9(dbConnection);
    this._dbMigrate9To10(dbConnection);
    this._dbMigrate10To11(dbConnection);
    this._dbMigrate11To12(dbConnection);
  },

  _dbMigrate6To12: function(dbConnection) {
    this._dbMigrate6To7(dbConnection);
    this._dbMigrate7To8(dbConnection);
    this._dbMigrate8To9(dbConnection);
    this._dbMigrate9To10(dbConnection);
    this._dbMigrate10To11(dbConnection);
    this._dbMigrate11To12(dbConnection);
  },

  _dbMigrate7To12: function(dbConnection) {
    this._dbMigrate7To8(dbConnection);
    this._dbMigrate8To9(dbConnection);
    this._dbMigrate9To10(dbConnection);
    this._dbMigrate10To11(dbConnection);
    this._dbMigrate11To12(dbConnection);
  },

  _dbMigrate8To12: function(dbConnection) {
    this._dbMigrate8To9(dbConnection);
    this._dbMigrate9To10(dbConnection);
    this._dbMigrate10To11(dbConnection);
    this._dbMigrate11To12(dbConnection);
  },

  _dbMigrate9To12: function(dbConnection) {
    this._dbMigrate9To10(dbConnection);
    this._dbMigrate10To11(dbConnection);
    this._dbMigrate11To12(dbConnection);
  },

  _dbMigrate10To12: function(dbConnection) {
    this._dbMigrate10To11(dbConnection);
    this._dbMigrate11To12(dbConnection);
  },

  _dbMigrate4To5: function(aDBConnection) {
    aDBConnection.executeSimpleSQL(
      "UPDATE sources SET lastRefreshed = lastRefreshed / 1000 / 86400 + 2440587.5"
    );
    aDBConnection.executeSimpleSQL(
      "UPDATE messages SET timestamp = timestamp / 1000 / 86400 + 2440587.5"
    );
    aDBConnection.executeSimpleSQL(
      "ALTER TABLE messages ADD COLUMN received REAL"
    );
  },

  _dbMigrate5To6: function(aDBConnection) {
    // Rename the old parts table.
    aDBConnection.executeSimpleSQL("ALTER TABLE parts RENAME TO partsOld");

    // Create the new parts and partsText tables.
    this._dbCreateTable(aDBConnection, "parts", this._dbSchema.tables.parts);
    this._dbCreateTable(aDBConnection, "partsText", this._dbSchema.tables.partsText);

    // Copy the data from the old to the new parts table.  It may look like
    // the tables are equivalent, but the old table was fulltext and didn't have
    // an "id" column (which we don't reference here because it gets populated
    // automagically as an AUTOINCREMENT PRIMARY KEY column).
    aDBConnection.executeSimpleSQL(
      "INSERT INTO parts(messageID, content, mediaType, partType, baseURI, languageTag) " +
      "SELECT            messageID, content, mediaType, partType, baseURI, languageCode " +
      "FROM partsOld"
    );

    // Insert data into the new partsText table.
    let selectStatement = this.createStatement("SELECT id, content, mediaType FROM parts", aDBConnection);
    let insertStatement = this.createStatement("INSERT INTO partsText (docid, content) VALUES (:docid, :content)", aDBConnection);
    try {
      while (selectStatement.step()) {
        let plainText = selectStatement.row.content;

        switch (selectStatement.row.mediaType) {
          case "text/html":
          case "application/xhtml+xml":
            // Use nsIFeedTextConstruct to convert the markup to plaintext.
            let (construct = Cc["@mozilla.org/feed-textconstruct;1"].
                             createInstance(Ci.nsIFeedTextConstruct)) {
              construct.text = selectStatement.row.content;
              construct.type = TEXT_CONSTRUCT_TYPES[selectStatement.row.mediaType];
              plainText = construct.plainText();
            }
            // Now that we've converted the markup to plain text, fall through
            // to the text/plain case that inserts the data into the database.

          case "text/plain":
            // Give the fulltext record the same doc ID as the row ID of the parts
            // record so we can join them together to get the part (and thence the
            // message) when doing a fulltext search.
            insertStatement.params.docid = selectStatement.row.id;
            insertStatement.params.content = plainText;
            insertStatement.execute();
            break;

          default:
            // It isn't a type we understand, so don't do anything with it.
            // XXX If it's text/*, shouldn't we fulltext index it anyway?
        }
      }
    }
    finally {
      selectStatement.reset();
    }

    // Drop the old parts table.
    aDBConnection.executeSimpleSQL("DROP TABLE partsOld");
  },

  /**
   * Migrate the database schema from version 6 to version 7.
   *
   * This doesn't actually change the physical database schema, it just removes
   * subjects from Twitter messages, since it no longer makes sense to store
   * tweets as both the subjects and the content of messages now that the views
   * support messages that don't necessarily have subjects.
   */
  _dbMigrate6To7: function(aDBConnection) {
    aDBConnection.executeSimpleSQL(
      "UPDATE messages SET subject = NULL WHERE sourceID IN " +
      "(SELECT id FROM sources WHERE type = 'SnowlTwitter')"
    );
  },

  /**
   * Migrate the database schema from version 7 to version 8.
   */
  _dbMigrate7To8: function(aDBConnection) {
    aDBConnection.executeSimpleSQL("ALTER TABLE sources ADD COLUMN username TEXT");
  },

  /**
   * Migrate the database schema from version 8 to version 9.
   */
  _dbMigrate8To9: function(dbConnection) {
    // Move the old messages table out of the way.
    dbConnection.executeSimpleSQL("ALTER TABLE messages RENAME TO messagesOld");

    // Create the new messages table and its index.
    this._dbCreateTable(dbConnection, "messages", this._dbSchema.tables.messages);
    this._dbCreateIndex(dbConnection, this._dbSchema.indexes[0]);

    // Copy messages that aren't from Twitter.
    dbConnection.executeSimpleSQL(
      "INSERT INTO messages(id, sourceID, externalID, subject, authorID, " +
      "                     timestamp, received, link, current, read) " +
      "SELECT      messagesOld.id, sourceID, externalID, subject, " +
      "            authorID, timestamp, received, link, current, read " +
      "FROM        messagesOld JOIN sources ON messagesOld.sourceID = sources.id " +
      "WHERE       sources.type != 'SnowlTwitter'"
    );

    // Copy messages that are from Twitter, converting their externalIDs
    // to integers in the process.
    dbConnection.executeSimpleSQL(
      "INSERT INTO messages(id, sourceID, externalID, subject, authorID, " +
      "                     timestamp, received, link, current, read) " +
      "SELECT      messagesOld.id, sourceID, CAST(externalID AS INTEGER), subject, " +
      "            authorID, timestamp, received, link, current, read " +
      "FROM        messagesOld JOIN sources ON messagesOld.sourceID = sources.id " +
      "WHERE       sources.type = 'SnowlTwitter'"
    );

    // Drop the old messages table.
    dbConnection.executeSimpleSQL("DROP TABLE messagesOld");
  },

  /**
   * Migrate the database schema from version 9 to version 10.
   */
  _dbMigrate9To10: function(dbConnection) {
    // Create the index on the messageID column in the parts table.
    this._dbCreateIndex(dbConnection, this._dbSchema.indexes[1]);
  },

  /**
   * Migrate the database schema from version 10 to version 11.
   */
  _dbMigrate10To11: function(dbConnection) {
    // Update the icon URLs for the sources and authors collections.
    // XXX There should be a better way to store and update these URLs.
    // For example, we could generate them dynamically in code based on
    // the type of collection.
    dbConnection.executeSimpleSQL("UPDATE collections SET iconURL = 'chrome://snowl/skin/livemarkFolder-16.png' WHERE groupIDColumn = 'sources.id'");
    dbConnection.executeSimpleSQL("UPDATE collections SET iconURL = 'chrome://snowl/skin/person-16.png' WHERE groupIDColumn = 'authors.id'");
  },

  /**
   * Migrate the database schema from version 11 to version 12.
   */
  _dbMigrate11To12: function(dbConnection) {
    dbConnection.executeSimpleSQL("ALTER TABLE sources ADD COLUMN placeID INTEGER");
    dbConnection.executeSimpleSQL("ALTER TABLE people ADD COLUMN placeID INTEGER");
  },

  get _selectHasSourceStatement() {
    let statement = this.createStatement(
      "SELECT name FROM sources WHERE machineURI = :machineURI"
    );
    this.__defineGetter__("_selectHasSourceStatement", function() { return statement });
    return this._selectHasSourceStatement;
  },

  selectHasSource: function(aMachineURI) {
    let name;

    try {
      this._selectHasSourceStatement.params.machineURI = aMachineURI;
      if (this._selectHasSourceStatement.step())
        name = this._selectHasSourceStatement.row["name"];
    }
    finally {
      this._selectHasSourceStatement.reset();
    }

    return name;
  },

  get _selectHasSourceUsernameStatement() {
    let statement = this.createStatement(
      "SELECT name, username FROM sources " +
      "WHERE machineURI = :machineURI AND username = :username"
    );
    this.__defineGetter__("_selectHasSourceUsernameStatement", function() { return statement });
    return this._selectHasSourceUsernameStatement;
  },

  selectHasSourceUsername: function(aMachineURI, aUsername) {
    let name, username;

    try {
      this._selectHasSourceUsernameStatement.params.machineURI = aMachineURI;
      this._selectHasSourceUsernameStatement.params.username = aUsername;
      if (this._selectHasSourceUsernameStatement.step()) {
        name = this._selectHasSourceUsernameStatement.row["name"];
        username = this._selectHasSourceUsernameStatement.row["username"];
      }
    }
    finally {
      this._selectHasSourceUsernameStatement.reset();
    }

    return [name, username];
  },


  get _selectHasMessageStatement() {
    let statement = this.createStatement(
      "SELECT 1 FROM messages WHERE externalID = :externalID"
    );
    this.__defineGetter__("_selectHasMessageStatement", function() { return statement });
    return this._selectHasMessageStatement;
  },

  selectHasMessage: function(aExternalID) {
    try {
      this._selectHasMessageStatement.params.externalID = aExternalID;
      if (this._selectHasMessageStatement.step())
        return true;
    }
    finally {
      this._selectHasMessageStatement.reset();
    }

    return false;
  },

  get _insertMessageStatement() {
    let statement = this.createStatement(
      "INSERT INTO messages(sourceID, externalID, subject, authorID, timestamp, received, link) \
       VALUES (:sourceID, :externalID, :subject, :authorID, :timestamp, :received, :link)"
    );
    this.__defineGetter__("_insertMessageStatement", function() { return statement });
    return this._insertMessageStatement;
  },

  /**
   * Insert a record into the messages table.
   * 
   * @param aSourceID    {integer} the record ID of the message source
   * @param aExternalID  {string}  the external ID of the message
   * @param aSubject     {string}  the title of the message
   * @param aAuthorID    {string}  the author of the message
   * @param aTimestamp   {real}    the Julian date when the message was sent
   * @param aReceived    {real}    the Julian date when the message was received
   * @param aLink        {string}  a link to the content of the message,
   *                               if the content is hosted on a server
   *
   * @returns {integer} the ID of the newly-created record
   */
  insertMessage: function(aSourceID, aExternalID, aSubject, aAuthorID, aTimestamp, aReceived, aLink) {
    this._insertMessageStatement.params.sourceID = aSourceID;
    this._insertMessageStatement.params.externalID = aExternalID;
    this._insertMessageStatement.params.subject = aSubject;
    this._insertMessageStatement.params.authorID = aAuthorID;
    this._insertMessageStatement.params.timestamp = aTimestamp;
    this._insertMessageStatement.params.received = aReceived;
    this._insertMessageStatement.params.link = aLink;
    this._insertMessageStatement.execute();

    return this.dbConnection.lastInsertRowID;
  },

  get _selectAttributeIDStatement() {
    let statement = this.createStatement(
      "SELECT id FROM attributes WHERE name = :name"
    );
    this.__defineGetter__("_selectAttributeIDStatement", function() { return statement });
    return this._selectAttributeIDStatement;
  },

  selectAttributeID: function(aName) {
    let id;

    try {
      this._selectAttributeIDStatement.params.name = aName;
      if (this._selectAttributeIDStatement.step())
        id = this._selectAttributeIDStatement.row["id"];
    }
    finally {
      this._selectAttributeIDStatement.reset();
    }

    return id;
  },

  // FIXME: insert the namespace, too, if available.
  get _insertAttributeStatement() {
    let statement = this.createStatement(
      "INSERT INTO attributes (name) VALUES (:name)"
    );
    this.__defineGetter__("_insertAttributeStatement", function() { return statement });
    return this._insertAttributeStatement;
  },

  /**
   * Insert a record into the attributes table.
   * 
   * @param aName         {string} the name of the attribute
   *
   * @returns {integer} the record ID of the newly-created record
   */
  insertAttribute: function(aName) {
    this._insertAttributeStatement.params.name = aName;
    this._insertAttributeStatement.execute();
    return this.dbConnection.lastInsertRowID;
  },

  get _insertMetadatumStatement() {
    let statement = this.createStatement(
      "INSERT INTO metadata (messageID, attributeID, value) \
       VALUES (:messageID, :attributeID, :value)"
    );
    this.__defineGetter__("_insertMetadatumStatement", function() { return statement });
    return this._insertMetadatumStatement;
  },

  /**
   * Insert a record into the metadata table.
   * 
   * @param aMessageID    {integer} the record ID of the message
   * @param aAttributeID  {integer} the record ID of the attribute
   * @param aValue        {string}  the value of the metadatum
   *
   * @returns {integer} the record ID of the newly-created record
   */
  insertMetadatum: function(aMessageID, aAttributeID, aValue) {
    this._insertMetadatumStatement.params.messageID = aMessageID;
    this._insertMetadatumStatement.params.attributeID = aAttributeID;

    try {
        this._insertMetadatumStatement.params.value = aValue;
    }
    catch(ex) {
      //dump(ex + " with attribute ID: " + aAttributeID + " and value: " + aValue + "\n");
      throw ex;
    }

    this._insertMetadatumStatement.execute();
    return this.dbConnection.lastInsertRowID;
  },

  get _selectIdentitiesSourceIDStatement() {
    let statement = this.createStatement(
      "SELECT sourceID FROM identities WHERE personID = :id"
    );
    this.__defineGetter__("_selectIdentitiesSourceIDStatement",
                          function() { return statement });
    return this._selectIdentitiesSourceIDStatement;
  },

  /**
   * Get sourceID for a people table entry from identities table.
   * 
   * @param aID {integer} the record ID of the people entry, which should be
   * tested against the peopleID value in identities
   *
   * @returns {integer} the sourceID of the people record
   */
  selectIdentitiesSourceID: function(aID) {
    let sourceID;

    try {
      this._selectIdentitiesSourceIDStatement.params.id = aID;
      if (this._selectIdentitiesSourceIDStatement.step()) {
        sourceID = this._selectIdentitiesSourceIDStatement.row["sourceID"];
      }
    }
    finally {
      this._selectIdentitiesSourceIDStatement.reset();
    }

    return sourceID;
  }

};

/**
 * Parsed query uri associated with a Places collection row.
 * 
 * @param aUri (string) - query string contained in the places item's uri.
 */
function SnowlQuery(aUri) {
  this.queryUri = decodeURI(aUri);
  if (this.queryUri) {
    if (this.queryUri.indexOf("place:") != -1)
      this.queryProtocol = "place:";
    else if (this.queryUri.indexOf("snowl:") != -1) {
      this.queryProtocol = "snowl:";
      this.queryID = this.queryUri.split(".id=")[1].split("&")[0];
      this.queryName = this.queryUri.split("name=")[1].split("&")[0];
      this.queryGroupIDColumn = this.queryUri.split("snowl:")[1].split("=")[0];
    }
  }
}
SnowlQuery.prototype = {
  queryUri: null,
  queryProtocol: null,
  queryID: null,
  queryName: null,
  queryGroupIDColumn: null,
};

/**
 * Places functions for Snowl
 */
let SnowlPlaces = {

  get _log() {
    let logger = Log4Moz.repository.getLogger("Snowl.SnowlPlaces");
    this.__defineGetter__("_log", function() logger);
    return this._log;
  },

  SNOWL_ROOT_ANNO: "Snowl",
  SNOWL_COLLECTIONS_FLAT_ANNO: "Snowl/CollectionsFlat",
  SNOWL_COLLECTIONS_GROUPED_ANNO: "Snowl/CollectionsGrouped",
  SNOWL_COLLECTIONS_GROUPEDFOLDER_ANNO: "Snowl/CollectionsGrouped/Folder/",
//  SMART_BOOKMARKS_ANNO: "Places/SmartBookmark",
  ORGANIZER_QUERY_ANNO: "PlacesOrganizer/OrganizerQuery",
  snowlRootID: null,
  collectionsFlatID: null,
  collectionsGroupedID: null,
  collectionsGroupedFolderID: null,
  initializedPlaces: false,
  convertedToPlaces: false,

  get queryFlat() {
    delete this._queryFlat;
    return this._queryFlat = "place:queryType=1&expandQueries=0&folder=" +
        this.collectionsFlatID;
  },

  get queryGrouped() {
    delete this._queryGrouped;
    return this._queryGrouped = "place:queryType=1&expandQueries=1&folder=" +
          this.collectionsGroupedID;
  },

  persistPlace: function(aTable, aId, aName, aMachineURI, aUsername, aIconURI, aSourceId) {
    let uri, iconUri, annoType;
    if (aTable == "sources") {
      uri = URI("snowl:sources.id=" + aId +
                "&name=" + aName +
//                "&machineURI=" + aMachineURI +
//                "&username=" + aUsername +
//                "&groupIDColumn=sources.id" +
                "&");
      annoType = "Sources";
    }
    else if (aTable == "people") {
      uri = URI("snowl:authors.id=" + aId +
                "&name=" + aName +
//                "&externalID=" + aUsername +
//                "&sourceID=" + aSourceId +
//                "&groupIDColumn=authors.id" +
                "&");
      annoType = "Authors";
    }
    else
      return null;

    let placeID = PlacesUtils.bookmarks.
                              insertBookmark(SnowlPlaces.collectionsFlatID,
                                             uri,
                                             PlacesUtils.bookmarks.DEFAULT_INDEX,
                                             aName);

    let anno = SnowlPlaces.SNOWL_COLLECTIONS_GROUPEDFOLDER_ANNO + annoType;
    PlacesUtils.annotations.
                setPageAnnotation(uri,
                                  anno,
                                  "snowl:sourceID=" + aSourceId,
                                  0,
                                  PlacesUtils.annotations.EXPIRE_NEVER);
//this._log.info(annoType + " iconURI.spec - " + (aIconURI ? aIconURI.spec : "null"));
    PlacesUtils.favicons.
//                setFaviconUrlForPage(uri,
                setAndLoadFaviconForPage(uri,
                                         aIconURI,
                                         false);
//this._log.info(aType + " name:placeID - " + aName + " : " + id);

    return placeID;
  },

  // Check for our places structure and create if not found
  init: function() {
    // Only do once for session
    if (this.initializedPlaces)
      return;

    let itemID, items;
    items = PlacesUtils.annotations.
                        getItemsWithAnnotation(this.SNOWL_ROOT_ANNO, {});
    if (items.length != 0 && items[0] != -1) {
      // Have our root..
      this.snowlRootID = items[0];
      // Get flat collection root
      items = PlacesUtils.annotations.
                          getItemsWithAnnotation(this.SNOWL_COLLECTIONS_FLAT_ANNO, {});
      this.collectionsFlatID = items[0];
      // Get grouped collection root
      items = PlacesUtils.annotations.
                          getItemsWithAnnotation(this.SNOWL_COLLECTIONS_GROUPED_ANNO, {});
      this.collectionsGroupedID = items[0];
      // Get grouped folder root
      items = PlacesUtils.annotations.
                          getItemsWithAnnotation(this.SNOWL_COLLECTIONS_GROUPEDFOLDER_ANNO, {});
      this.collectionsGroupedFolderID = items[0];

      this.convertedToPlaces = true;
    }
    else {
      // Create places stucture
      itemID = PlacesUtils.bookmarks.
                           createFolder(PlacesUtils.placesRootId,
                                        "snowlRoot",
                                        -1);
      // Ensure immediate children can't be removed
      PlacesUtils.bookmarks.setFolderReadonly(itemID, true);
      // Create annotation
      PlacesUtils.annotations.
                  setItemAnnotation(itemID,
                                    this.SNOWL_ROOT_ANNO,
                                    "snowl:root",
                                    0,
                                    PlacesUtils.annotations.EXPIRE_NEVER);
      this.snowlRootID = itemID;

      // Create flat collections root
      itemID = PlacesUtils.bookmarks.
                           createFolder(this.snowlRootID,
                                        "snowlCollectionsFlat",
                                        PlacesUtils.bookmarks.DEFAULT_INDEX);
      PlacesUtils.annotations.
                  setItemAnnotation(itemID,
                                    this.SNOWL_COLLECTIONS_FLAT_ANNO,
                                    "snowl:collectionsFlat",
                                    0,
                                    PlacesUtils.annotations.EXPIRE_NEVER);
      this.collectionsFlatID = itemID;

      // Create grouped collections root
      itemID = PlacesUtils.bookmarks.
                           createFolder(this.snowlRootID,
                                        "snowlCollectionsGrouped",
                                        PlacesUtils.bookmarks.DEFAULT_INDEX);
      PlacesUtils.annotations.
                  setItemAnnotation(itemID,
                                    this.SNOWL_COLLECTIONS_GROUPED_ANNO,
                                    "snowl:collectionsGrouped",
                                    0,
                                    PlacesUtils.annotations.EXPIRE_NEVER);
      this.collectionsGroupedID = itemID;
      // Ensure immediate child can't be removed
      PlacesUtils.bookmarks.setFolderReadonly(itemID, true);

      // Create grouped collections folder
      itemID = PlacesUtils.bookmarks.
                           createFolder(this.collectionsGroupedID,
                                        "All Messages",
                                        PlacesUtils.bookmarks.DEFAULT_INDEX);
      PlacesUtils.annotations.
                  setItemAnnotation(itemID,
                                    this.SNOWL_COLLECTIONS_GROUPEDFOLDER_ANNO,
                                    "snowl:collectionsGroupedFolder",
                                    0,
                                    PlacesUtils.annotations.EXPIRE_NEVER);
      this.collectionsGroupedFolderID = itemID;

      // Default collections
      let collections = [];
      // All
      coll = {queryId:  "snowl:AllMessages",
              itemId:   null,
              title:    strings.get("allCollectionName"),
              uri:      URI("place:folder=" + this.collectionsFlatID +
                            "&OR" +
                            "&expandQueries=0" +
                            "&annotation=" +
                            this.SNOWL_COLLECTIONS_FLAT_ANNO),
              parent:   this.collectionsFlatID,
              position: PlacesUtils.bookmarks.DEFAULT_INDEX};
      collections.push(coll);

      // Sources
      coll = {queryId:  "snowl:AllSources",
              itemId:   null,
              title:    strings.get("sourcesCollectionName"),
              uri:      URI("place:folder=" + this.collectionsGroupedFolderID +
                            "&OR" +
                            "&annotation=" +
                            this.SNOWL_COLLECTIONS_GROUPEDFOLDER_ANNO + "Sources" +
                            "&expandQueries=1" +
                            "&queryType=" +
                            Ci.nsINavHistoryQueryOptions.QUERY_TYPE_BOOKMARKS +
                            "&sort=" +
                            Ci.nsINavHistoryQueryOptions.SORT_BY_TITLE_ASCENDING),
              parent:   this.collectionsGroupedFolderID,
              position: PlacesUtils.bookmarks.DEFAULT_INDEX};
      collections.push(coll);
      // Authors
      coll = {queryId:  "snowl:AllAuthors",
              itemId:   null,
              title:    strings.get("authorsCollectionName"),
              uri:      URI("place:folder=" + this.collectionsGroupedFolderID +
                            "&OR" +
                            "&annotation=" +
                            this.SNOWL_COLLECTIONS_GROUPEDFOLDER_ANNO + "Authors" +
                            "&expandQueries=1" +
                            "&queryType=" +
                            Ci.nsINavHistoryQueryOptions.QUERY_TYPE_BOOKMARKS +
                            "&sort=" +
                            Ci.nsINavHistoryQueryOptions.SORT_BY_TITLE_ASCENDING),
              parent:   this.collectionsGroupedFolderID,
              position: PlacesUtils.bookmarks.DEFAULT_INDEX};
      collections.push(coll);
      // Add the collections
      for each(let coll in collections) {
        coll.itemId = PlacesUtils.bookmarks.insertBookmark(coll.parent,
                                                           coll.uri,
                                                           coll.position,
                                                           coll.title);
        PlacesUtils.annotations.
//                    setPageAnnotation(coll.itemId,
                    setItemAnnotation(coll.itemId,
                                      this.ORGANIZER_QUERY_ANNO,
                                      coll.queryId,
                                      0,
                                      PlacesUtils.annotations.EXPIRE_NEVER);
      };

      this.convertedToPlaces = false;
    }

    this.initializedPlaces = true;
  }

};

// FIXME: don't wrap statements in this wrapper for stable releases.

/**
 * An implementation of mozIStorageStatementWrapper that logs execution times
 * for debugging.  Even though this implements an XPCOM interface, it isn't
 * an XPCOM component, it's a regular JS object, so instead of instantiating it
 * via createInstance, do |new InstrumentedStorageStatement()|.
 *
 * @param sqlString {string} the SQL string used to construct the statement
 *                           (optional, but essential for useful debugging)
 */
function InstrumentedStorageStatement(sqlString) {
  this._sqlString = sqlString;
  //this._log = Log4Moz.repository.getLogger("Snowl.Statement");
}

InstrumentedStorageStatement.prototype = {
  /**
   * The SQL string used to construct the statement.  We log this along with
   * the execution time when the statement is executed.
   */
  _sqlString: null,

  /**
   * The wrapped mozIStorageStatementWrapper (which itself wraps
   * a mozIStorageStatement).
   */
  _statement: null,

  get _log() {
    let log = Log4Moz.repository.getLogger("Snowl.Statement");
    this.__defineGetter__("_log", function() log);
    return this._log;
  },

  // nsISupports
  QueryInterface: XPCOMUtils.generateQI([Ci.mozIStorageStatementWrapper]),

  // mozIStorageStatementWrapper

  initialize: function(statement) {
    this._statement = Cc["@mozilla.org/storage/statement-wrapper;1"].
                      createInstance(Ci.mozIStorageStatementWrapper);
    this._statement.initialize(statement);
  },

  get statement() { return this._statement },
  reset: function() { return this._statement.reset() },

  step: function() {
    // We don't want to log every step, just the first one, which triggers
    // the execution of the query and is potentially slow.
    let log = (this._statement.statement.state != Ci.mozIStorageStatement.MOZ_STORAGE_STATEMENT_EXECUTING);

    let before = new Date();
    let rv = this._statement.step();
    let after = new Date();
    let time = after - before;
    if (log)
      this._log.trace(time + "ms to step initially " + this._sqlString);
    return rv;
  },

  execute: function() {
    let before = new Date();
    let rv = this._statement.execute();
    let after = new Date();
    let time = after - before;
    this._log.trace(time + "ms to execute " + this._sqlString);
    return rv;
  },
  get row() { return this._statement.row },
  get params() { return this._statement.params }
};


SnowlDatastore._dbInit();
