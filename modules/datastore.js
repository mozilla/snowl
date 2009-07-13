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
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/StringBundle.js");
Cu.import("resource://snowl/modules/URI.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/constants.js");

let strings = new StringBundle("chrome://snowl/locale/datastore.properties");

const TABLE_TYPE_NORMAL = 0;
const TABLE_TYPE_FULLTEXT = 1;

let SnowlDatastore = {
  get _storage() {
    delete this._storage;
    return this._storage = Cc["@mozilla.org/storage/service;1"].
                           getService(Ci.mozIStorageService);
  },

  get _log() {
    delete this._log;
    return this._log = Log4Moz.repository.getLogger("Snowl.Datastore");
  },

  //**************************************************************************//
  // Database Creation & Access

  _dbVersion: 13,

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

  // Statements that are created via the createStatement method.  We use this
  // to finalize statements when finalizeStatements is called (so we can close
  // the connection).
  _statements: [],

  createStatement: function(aSQLString, aDBConnection) {
    let dbConnection = aDBConnection ? aDBConnection : this.dbConnection;
    let wrappedStatement;

    try {
      let statement = dbConnection.createStatement(aSQLString);
      wrappedStatement = new InstrumentedStorageStatement(aSQLString, statement);
    }
    catch(ex) {
      throw("error creating statement " + aSQLString + " - " +
            dbConnection.lastError + ": " +
            dbConnection.lastErrorString + " - " + ex);
    }

    this._statements.push(wrappedStatement);
    return wrappedStatement;
  },

  finalizeStatements: function() {
    for each (statement in this._statements) {
      if (statement instanceof InstrumentedStorageStatement)
        statement = statement._statement;
      if (statement instanceof Ci.mozIStorageStatementWrapper)
        statement = statement.statement;
      if (statement instanceof Ci.mozIStorageStatement)
        statement.finalize();
      else
        this._log.warning("can't finalize " + statement);
    }
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
        // We have to dump here because this runs before the service
        // has initialized the logger.
        // FIXME: initialize the logger first so we can use it here.
        dump("migrating database from " + aOldVersion + " to " + aNewVersion + "\n");
        let start = new Date();
        this["_dbMigrate" + aOldVersion + "To" + aNewVersion](aDBConnection);
        aDBConnection.schemaVersion = aNewVersion;
        aDBConnection.commitTransaction();
        let end = new Date();
        dump("database migration took " + (end - start) + "ms" + "\n");
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
  _dbMigrate0To13: function(dbConnection) {
    this._dbCreate(dbConnection);
  },

  _dbMigrate4To13: function(dbConnection) {
    this._dbMigrate4To5(dbConnection);
    this._dbMigrate5To6(dbConnection);
    this._dbMigrate6To7(dbConnection);
    this._dbMigrate7To8(dbConnection);
    this._dbMigrate8To9(dbConnection);
    this._dbMigrate9To10(dbConnection);
    this._dbMigrate10To11(dbConnection);
    this._dbMigrate11To12(dbConnection);
    this._dbMigrate12To13(dbConnection);
  },

  _dbMigrate5To13: function(dbConnection) {
    this._dbMigrate5To6(dbConnection);
    this._dbMigrate6To7(dbConnection);
    this._dbMigrate7To8(dbConnection);
    this._dbMigrate8To9(dbConnection);
    this._dbMigrate9To10(dbConnection);
    this._dbMigrate10To11(dbConnection);
    this._dbMigrate11To12(dbConnection);
    this._dbMigrate12To13(dbConnection);
  },

  _dbMigrate6To13: function(dbConnection) {
    this._dbMigrate6To7(dbConnection);
    this._dbMigrate7To8(dbConnection);
    this._dbMigrate8To9(dbConnection);
    this._dbMigrate9To10(dbConnection);
    this._dbMigrate10To11(dbConnection);
    this._dbMigrate11To12(dbConnection);
    this._dbMigrate12To13(dbConnection);
  },

  _dbMigrate7To13: function(dbConnection) {
    this._dbMigrate7To8(dbConnection);
    this._dbMigrate8To9(dbConnection);
    this._dbMigrate9To10(dbConnection);
    this._dbMigrate10To11(dbConnection);
    this._dbMigrate11To12(dbConnection);
    this._dbMigrate12To13(dbConnection);
  },

  _dbMigrate8To13: function(dbConnection) {
    this._dbMigrate8To9(dbConnection);
    this._dbMigrate9To10(dbConnection);
    this._dbMigrate10To11(dbConnection);
    this._dbMigrate11To12(dbConnection);
    this._dbMigrate12To13(dbConnection);
  },

  _dbMigrate9To13: function(dbConnection) {
    this._dbMigrate9To10(dbConnection);
    this._dbMigrate10To11(dbConnection);
    this._dbMigrate11To12(dbConnection);
    this._dbMigrate12To13(dbConnection);
  },

  _dbMigrate10To13: function(dbConnection) {
    this._dbMigrate10To11(dbConnection);
    this._dbMigrate11To12(dbConnection);
    this._dbMigrate12To13(dbConnection);
  },

  _dbMigrate11To13: function(dbConnection) {
    this._dbMigrate11To12(dbConnection);
    this._dbMigrate12To13(dbConnection);
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

  /**
   * Migrate the database schema from version 12 to 13.
   */
  _dbMigrate12To13: function(dbConnection) {
    dbConnection.executeSimpleSQL("DROP TABLE metadata");
    dbConnection.executeSimpleSQL("DROP TABLE personMetadata");
    dbConnection.executeSimpleSQL("DROP TABLE attributes");
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

  get _selectHasIdentityMessageStatement() {
    let statement = this.createStatement(
      "SELECT 1 FROM messages " +
      "WHERE authorID = :authorID AND " +
      "      current <> " + MESSAGE_CURRENT_PENDING_PURGE
    );
    this.__defineGetter__("_selectHasIdentityMessageStatement", function() { return statement });
    return this._selectHasIdentityMessageStatement;
  },

  selectHasIdentityMessage: function(aAuthorID) {
    let hasMessage = false;
    try {
      this._selectHasIdentityMessageStatement.params.authorID = aAuthorID;
      if (this._selectHasIdentityMessageStatement.step())
        hasMessage = true;
    }
    finally {
      this._selectHasIdentityMessageStatement.reset();
    }

    return hasMessage;
  },

  get _selectHasAuthorIdentityStatement() {
    let statement = this.createStatement(
      "SELECT 1 FROM identities " +
      "WHERE personID = :authorID"
    );
    this.__defineGetter__("_selectHasAuthorIdentityStatement", function() { return statement });
    return this._selectHasAuthorIdentityStatement;
  },

  selectHasAuthorIdentity: function(aAuthorID) {
    let hasIdentity = false;
    try {
      this._selectHasAuthorIdentityStatement.params.authorID = aAuthorID;
      if (this._selectHasAuthorIdentityStatement.step())
        hasIdentity = true;
    }
    finally {
      this._selectHasAuthorIdentityStatement.reset();
    }

    return hasIdentity;
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

  get _selectIdentitiesSourceIDStatement() {
    let statement = this.createStatement(
      "SELECT sourceID, externalID FROM identities WHERE personID = :id"
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
    let sourceID, externalID;

    try {
      this._selectIdentitiesSourceIDStatement.params.id = aID;
      if (this._selectIdentitiesSourceIDStatement.step()) {
        sourceID = this._selectIdentitiesSourceIDStatement.row["sourceID"];
        externalID = this._selectIdentitiesSourceIDStatement.row["externalID"];
      }
    }
    finally {
      this._selectIdentitiesSourceIDStatement.reset();
    }

    return [sourceID, externalID];
  },

  _collectionStatsStatement: function(aType) {
    let query;
    switch (aType) {
      case "all":
        query = "SELECT id AS collectionID, " +
                "  COUNT(messages.id)   AS total, " +
                "  SUM(read)            AS read, " +
                "  SUM(ROUND(read/2,0)) AS new " +
                "FROM messages " +
                "WHERE (current = " + MESSAGE_NON_CURRENT + " OR " +
                "       current = " + MESSAGE_CURRENT + ") ";
        break;
      case "source":
        query = "SELECT sourceID AS collectionID, " +
                "  COUNT(messages.id)   AS total, " +
                "  SUM(read)            AS read, " +
                "  SUM(ROUND(read/2,0)) AS new " +
                "FROM messages " +
                "WHERE (current = " + MESSAGE_NON_CURRENT + " OR " +
                "       current = " + MESSAGE_CURRENT + ") GROUP BY collectionID";
        break;
      case "author":
        query = "SELECT authorID, identities.id, identities.personID AS collectionID, " +
                "  COUNT(messages.id)   AS total, " +
                "  SUM(read)            AS read, " +
                "  SUM(ROUND(read/2,0)) AS new " +
                "FROM messages " +
                "LEFT JOIN identities ON messages.authorID = identities.id " +
                "WHERE (current = " + MESSAGE_NON_CURRENT + " OR " +
                "       current = " + MESSAGE_CURRENT + ") GROUP BY collectionID";
        break;
    }

    return this.createStatement(query);
  },

  collectionStatsByCollectionID: function() {
    // Stats object for collections tree properties.
    let statement, type, types = ["all", "source", "author"];
    let collectionID, Total, Read, New, collectionStats = {};

    try {
      for each (type in types) {
        statement = this._collectionStatsStatement(type);
        while (statement.step()) {
          if (statement.row["collectionID"] == null)
            continue;

          collectionID = type == "all" ?
              "all" : type[0] + statement.row["collectionID"];

          Total =  statement.row["total"];
          Read = statement.row["read"];
          New = statement.row["new"];
          collectionStats[collectionID] = {
            t: Total,
            u: Total - Read + MESSAGE_NEW * New,
            n: New
          }
        }
      }
    }
    catch(ex) {
      this._log.error(ex);
    }
    finally {
      statement.reset();
    }

    return collectionStats;
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
    if (this.queryUri.indexOf("place:") != -1) {
      this.queryProtocol = "place:";
      this.queryFolder = this.queryUri.indexOf("folder=") != -1 ?
          this.queryUri.split("folder=")[1].split("&")[0] : null;
    }
    else if (this.queryUri.indexOf("snowl:") != -1) {
      this.queryProtocol = "snowl:";
      this.queryID = this.queryUri.split(".id=")[1].split("&")[0];
      if (this.queryUri.indexOf("&a.id=") != -1) {
        this.queryGroupIDColumn = "people.id";
        this.queryTypeAuthor = true;
      }
      else if (this.queryUri.indexOf("&s.id=") != -1) {
        this.queryGroupIDColumn = "sources.id";
        this.queryTypeSource = true;
      }
    }
    
  }
}
SnowlQuery.prototype = {
  queryUri: null,
  queryProtocol: null,
  queryID: null,
  queryFolder: null,
  queryTypeSource: false,
  queryTypeAuthor: false,
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

  _placesVersion: 2,
  _placesConverted: false,
  _placesInitialized: false,

  getPlacesVersion: function(snowlPlacesRoot) {
    let verInfo = PlacesUtils.annotations
                             .getItemAnnotation(snowlPlacesRoot,
                                                this.SNOWL_ROOT_ANNO);
this._log.info("getPlacesVersion: " + verInfo);
    let curVer = verInfo.split("version=")[1] ?
        verInfo.split("version=")[1].split("&")[0] : null;
    let curConv = verInfo.split("converted=")[1] ?
        verInfo.split("converted=")[1] : false;
    this._placesConverted = curConv == "true" ? true : false;
    return curVer;
  },

  setPlacesVersion: function(snowlPlacesRoot) {
    let verInfo = "version=" + this._placesVersion +
                  "&converted=" + this._placesConverted;
this._log.info("setPlacesVersion: " + verInfo);
    PlacesUtils.annotations.
                setItemAnnotation(snowlPlacesRoot,
                                  this.SNOWL_ROOT_ANNO,
                                  verInfo,
                                  0,
                                  this.EXPIRE_NEVER);
  },

  SNOWL_ROOT_ANNO: "Snowl",
  SNOWL_COLLECTIONS_ANNO: "Snowl/Collections",
  SNOWL_COLLECTIONS_SYSTEM_ANNO: "Snowl/Collections/System",
  SNOWL_COLLECTIONS_SOURCE_ANNO: "Snowl/Collections/Source",
  SNOWL_COLLECTIONS_AUTHOR_ANNO: "Snowl/Collections/Author",
  SNOWL_USER_ANNO: "Snowl/User",
  SNOWL_USER_VIEW_ANNO: "Snowl/User/View",
  SNOWL_USER_VIEWLIST_ANNO: "Snowl/User/ViewList",
  SNOWL_PROPERTIES_ANNO: "Snowl/Properties",

  EXCLUDE_FROM_BACKUP_ANNO: "places/excludeFromBackup",
  EXPIRE_NEVER: PlacesUtils.annotations.EXPIRE_NEVER,
  DEFAULT_INDEX: PlacesUtils.bookmarks.DEFAULT_INDEX,

  queryDefault: "place:queryType=1&expandQueries=0&excludeReadOnlyFolders=0&folder=",
  querySources: "place:queryType=1&expandQueries=0&sort=1&folder=",
  queryAuthors: "place:queryType=1&expandQueries=0&sort=1&folder=",
  queryCustom:  "place:queryType=1&expandQueries=0&folder=",

  get collectionsSystemID() {
    delete this.collectionsSystemID;
    return this.collectionsSystemID = this.snowlPlacesQueries["snowlCollectionsSystem"];
  },
  set collectionsSystemID(val) {
    delete this.collectionsSystemID;
    return this.collectionsSystemID = val;
  },

  get collectionsSourcesID() {
    delete this.collectionsSourcesID;
    return this.collectionsSourcesID = this.snowlPlacesQueries["snowlCollectionsSources"];
  },
  set collectionsSourcesID(val) {
    delete this.collectionsSourcesID;
    return this.collectionsSourcesID = val;
  },

  get collectionsAuthorsID() {
    delete this.collectionsAuthorsID;
    return this.collectionsAuthorsID = this.snowlPlacesQueries["snowlCollectionsAuthors"];
  },
  set collectionsAuthorsID(val) {
    delete this.collectionsAuthorsID;
    return this.collectionsAuthorsID = val;
  },

  get collectionsAllID() {
    delete this.collectionsAllID;
    return this.collectionsAllID = this.snowlPlacesQueries["snowlCollectionsAll"];
  },
  set collectionsAllID(val) {
    delete this.collectionsAllID;
    return this.collectionsAllID = val;
  },

  get userRootID() {
    delete this.userRootID;
    return this.userRootID = this.snowlPlacesQueries["snowlUserRoot"];
  },
  set userRootID(val) {
    delete this.userRootID;
    return this.userRootID = val;
  },

/**
 * Add a Places bookmark for a snowl source or author collection
 * 
 * @aTable      - messages.sqlite sources or people table
 * @aId         - table id of source or author record
 * @aName       - name
 * @aMachineURI - url
 * @aUsername   - externalID from people table
 * @aIconURI    - favicon
 * @aSourceId   - sourceId of source or author record
 */
  persistPlace: function(aTable, aId, aName, aMachineURI, aUsername, aIconURI, aSourceId) {
    let uri, parent, anno, properties, placeID;
    if (aTable == "sources") {
      uri = URI("snowl:sId=" + aSourceId +
                "&s.id=" + aId +
                "&u=" + aMachineURI.spec +
                "&");
      parent = this.collectionsSourcesID;
      anno = this.SNOWL_COLLECTIONS_SOURCE_ANNO;
      properties = "source";
    }
    else if (aTable == "people") {
      uri = URI("snowl:sId=" + aSourceId +
                "&a.id=" + aId +
                "&e=" + aUsername +
                "&");
      parent = this.collectionsAuthorsID;
      anno = this.SNOWL_COLLECTIONS_AUTHOR_ANNO;
      properties = "author";
    }
    else
      return null;

    try {
      placeID = PlacesUtils.bookmarks.
                            insertBookmark(parent,
                                           uri,
                                           this.DEFAULT_INDEX,
                                           aName);
      PlacesUtils.annotations.
                  setPageAnnotation(uri,
                                    anno,
                                    properties,
                                    0,
                                    this.EXPIRE_NEVER);

//this._log.info(aTable + " iconURI.spec - " + (aIconURI ? aIconURI.spec : "null"));
      PlacesUtils.favicons.
                  setAndLoadFaviconForPage(uri,
                                           aIconURI,
                                           false);
    }
    catch(ex) {
      this._log.error("persistPlace: parentId:aName:uri - " +
                      parent + " : " + aName + " : " + uri.spec );
      this._log.error(ex);
    }

    return placeID;
  },

/**
 * Remove bookmarks based on full or partial uri
 * 
 * @aUri    - full or partial uri to remove by
 * @aPrefix - if true, find by prefixed partial uri
 */
  removePlacesItemsByURI: function (aUri, aPrefix) {
    let node, bookmarkIds = [], uniqueIds = [];
    let query = PlacesUtils.history.getNewQuery();
    query.setFolders([SnowlPlaces.collectionsSystemID], 1);
    query.uri = URI(aUri);
    query.uriIsPrefix = aPrefix ? aPrefix : false;
    let options = PlacesUtils.history.getNewQueryOptions();
    options.queryType = options.QUERY_TYPE_BOOKMARKS;

    let rootNode = PlacesUtils.history.executeQuery(query, options).root;
    rootNode.containerOpen = true;

    // Multiple identical uris return multiple itemIds in one call, so
    // bookmarkIds may have duplicates.  Also, close node before any deletes.
    for (let i = 0; i < rootNode.childCount; i ++) {
      node = rootNode.getChild(i);
      bookmarkIds = bookmarkIds.concat(PlacesUtils.bookmarks.
                                                   getBookmarkIdsForURI(URI(node.uri), {}));
    }
    rootNode.containerOpen = false;

    // Remove duplicates from the array, if any
    bookmarkIds.forEach(function(itemid) {
      if (uniqueIds.indexOf(itemid, 0) < 0)
        uniqueIds.push(itemid);
    })

    // Remove the bookmarks
    uniqueIds.forEach(function(itemid) {
      PlacesUtils.bookmarks.removeItem(itemid);
    })
  },

/**
 * Called from Properties dialog on save, for View adds and View and Source/Author
 * name changes, and from setCellText tree inline rename.
 * 
 * @aNode      - node
 * @aUri       - uri
 * @aNewTitle  - new title
 */
  renamePlace: function(aItemId, aUri, aNewTitle) {
    let itemChangedObj = {
      itemId: aItemId,
      type: null,
      property: "title",
      uri: aUri,
      title: aNewTitle
    }
  
    if (PlacesUtils.annotations.
                    itemHasAnnotation(aItemId,
                                      this.SNOWL_USER_VIEWLIST_ANNO)) {
      // View shortcut folder.
      itemChangedObj.type = "view";
    }
    else {
      let parentId = PlacesUtils.bookmarks.getFolderIdForItem(aItemId);
      if (parentId == this.collectionsSourcesID ||
          parentId == this.collectionsAuthorsID)
        // Source/author folder.
        itemChangedObj.type = "collection";
      else
        return;
    }
  
    Observers.notify("itemchanged", itemChangedObj);
    return;
  },

/**
 * Build a map of queryIds (any unique name) and itemIds for an annotation.
 * 
 * @aAnno    - annotation to map
 */
  buildNameItemMap: function(aAnno) {
    let map = {};
    let items = PlacesUtils.annotations
                           .getItemsWithAnnotation(aAnno, {});
    for (var i=0; i < items.length; i++) {
      let queryName = PlacesUtils.annotations.
                                  getItemAnnotation(items[i], aAnno);
      map[queryName] = items[i];
this._log.info("buildNameItemMap: " + queryName + " - " + items[i]);
    }

    return map;
  },

  resetNameItemMap: function() {
    this.collectionsSystemID  = this.snowlPlacesQueries["snowlCollectionsSystem"];
    this.collectionsSourcesID = this.snowlPlacesQueries["snowlCollectionsSources"];
    this.collectionsAuthorsID = this.snowlPlacesQueries["snowlCollectionsAuthors"];
    this.collectionsAllID     = this.snowlPlacesQueries["snowlCollectionsAll"];
    this.userRootID           = this.snowlPlacesQueries["snowlUserRoot"];
  },

  // Init snowl Places structure, delay to allow logger to set up.
  init: function() {
    // Only do once for session.
    if (this._placesInitialized)
      return;

    let timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    let callback = { notify: function(aTimer) { SnowlPlaces.delayedInit() } };
    timer.initWithCallback(callback, 10, Ci.nsITimer.TYPE_ONE_SHOT);
  },

  // Check for snowl Places structure and create if not found.
  delayedInit: function() {
    let items, itemID, collsysID, colluserID;
    let snowlPlacesRoot = -1;
    items = PlacesUtils.annotations
                       .getItemsWithAnnotation(this.SNOWL_USER_ANNO, {});

    // Check for collections user root.
    if (items.length != 1 || items[0] == -1) {
      // Not found - create user root, which will contain user defined Views.
      // This folder must therefore be preserved across rebuilds and is backed
      // up via Places in .json files.  It is thus a child of the Places root.
      // It is outside the rebuild process and any changes to it or its children
      // must be considered separately in the context of user data.
this._log.info("init: Initializing Snowl Places User Root...");
      colluserID = PlacesUtils.bookmarks.
                               createFolder(PlacesUtils.placesRootId,
                                            "snowlUserRoot",
                                            this.DEFAULT_INDEX);
      PlacesUtils.annotations.
                  setItemAnnotation(colluserID,
                                    this.SNOWL_USER_ANNO,
                                    "snowlUserRoot",
                                    0,
                                    this.EXPIRE_NEVER);
      PlacesUtils.annotations.
                  setItemAnnotation(colluserID,
                                    this.SNOWL_COLLECTIONS_ANNO,
                                    "snowlUserRoot",
                                    0,
                                    this.EXPIRE_NEVER);

      // Create collections custom View folder.
      itemID = PlacesUtils.bookmarks.
                           createFolder(colluserID,
                                        "snowlUserView:" +
                                          strings.get("customCollectionName"),
                                        this.DEFAULT_INDEX);
      PlacesUtils.annotations.
                  setItemAnnotation(itemID,
                                    this.SNOWL_USER_VIEW_ANNO,
                                    "snowlUserView",
                                    0,
                                    this.EXPIRE_NEVER);
    }

    // Check rest of snowl Places structure.
    items = PlacesUtils.annotations
                       .getItemsWithAnnotation(this.SNOWL_ROOT_ANNO, {});

    if (items.length > 1) {
      // Something went wrong, we cannot have more than one left pane folder,
      // remove all left pane folders and generate a correct new one.
      items.forEach(function(aItem) {
        PlacesUtils.bookmarks.removeItem(aItem);
      });
    }
    else if (items.length == 1 && items[0] != -1) {
      snowlPlacesRoot = items[0];
      // Check snowl Places version
      let version = this.getPlacesVersion(snowlPlacesRoot);
      if (version != this._placesVersion || !this._placesConverted) {
        // If version is not valid or converted flag not set then rebuild the
        // snowl Places structure.
        PlacesUtils.bookmarks.removeItem(snowlPlacesRoot);
        snowlPlacesRoot = -1;
        this._placesConverted = false;
      }
    }

    if (snowlPlacesRoot != -1) {
      // Build the map.
      delete this.snowlPlacesQueries;
      this.snowlPlacesQueries = this.buildNameItemMap(this.SNOWL_COLLECTIONS_ANNO);

      this._placesInitialized = true;

      // Set the root itemId.
      delete this.snowlPlacesFolderId;
      return this.snowlPlacesFolderId = snowlPlacesRoot;
    }

this._log.info("init: Rebuilding Snowl Places...");

//    var callback = {
//      runBatched: function(aUserData) {
//        delete self.snowlPlacesQueries;
//        self.snowlPlacesQueries = { };

        // Create snowl Places root folder.  This folder and thus its children
        // are excluded from Places backup, as underlying data exists in the
        // messages db and the structure would need to be rebuilt for any changes
        // or for recovery etc.
        snowlPlacesRoot = PlacesUtils.bookmarks.
                                      createFolder(PlacesUtils.placesRootId,
                                                   "snowlRoot",
                                                   this.DEFAULT_INDEX);
        PlacesUtils.annotations.
                    setItemAnnotation(snowlPlacesRoot,
                                      this.SNOWL_ROOT_ANNO,
                                      this._placesVersion,
                                      0,
                                      this.EXPIRE_NEVER);
        PlacesUtils.annotations.
                    setItemAnnotation(snowlPlacesRoot,
                                      this.EXCLUDE_FROM_BACKUP_ANNO,
                                      1,
                                      0,
                                      this.EXPIRE_NEVER);
        // Ensure immediate children can't be removed
        PlacesUtils.bookmarks.setFolderReadonly(snowlPlacesRoot, true);

        // Create collections system.
        collsysID = PlacesUtils.bookmarks.
                                createFolder(snowlPlacesRoot,
                                             "snowlCollectionsSystem",
                                             this.DEFAULT_INDEX);
        PlacesUtils.annotations.
                    setItemAnnotation(collsysID,
                                      this.SNOWL_COLLECTIONS_ANNO,
                                      "snowlCollectionsSystem",
                                      0,
                                      this.EXPIRE_NEVER);
        PlacesUtils.annotations.
                    setItemAnnotation(collsysID,
                                      this.SNOWL_COLLECTIONS_SYSTEM_ANNO,
                                      "snowlCollectionsSystem",
                                      0,
                                      this.EXPIRE_NEVER);
        // Ensure immediate children can't be removed.
        PlacesUtils.bookmarks.setFolderReadonly(collsysID, true);

        // Create sources collections folder.
        itemID = PlacesUtils.bookmarks.
                             createFolder(collsysID,
                                          strings.get("sourcesCollectionName"),
                                          this.DEFAULT_INDEX);
        PlacesUtils.annotations.
                    setItemAnnotation(itemID,
                                      this.SNOWL_COLLECTIONS_ANNO,
                                      "snowlCollectionsSources",
                                      0,
                                      this.EXPIRE_NEVER);
        PlacesUtils.annotations.
                    setItemAnnotation(itemID,
                                      this.SNOWL_PROPERTIES_ANNO,
                                      "sysCollection",
                                      0,
                                      this.EXPIRE_NEVER);
        // Ensure immediate children can't be removed.
        PlacesUtils.bookmarks.setFolderReadonly(itemID, true);

        // Create authors collections folder.
        itemID = PlacesUtils.bookmarks.
                             createFolder(collsysID,
                                          strings.get("authorsCollectionName"),
                                          this.DEFAULT_INDEX);
        PlacesUtils.annotations.
                    setItemAnnotation(itemID,
                                      this.SNOWL_COLLECTIONS_ANNO,
                                      "snowlCollectionsAuthors",
                                      0,
                                      this.EXPIRE_NEVER);
        PlacesUtils.annotations.
                    setItemAnnotation(itemID,
                                      this.SNOWL_PROPERTIES_ANNO,
                                      "sysCollection",
                                      0,
                                      this.EXPIRE_NEVER);
        // Ensure immediate children can't be removed.
        PlacesUtils.bookmarks.setFolderReadonly(itemID, true);

        // Default collections.  These are folder shortcuts.
        let coll, collections = [], viewItems, name;
        // All Messages.
        coll = {property: "sysCollection",
                itemId:   null,
                value:    "snowlCollectionsAll",
                title:    strings.get("allCollectionName"),
                uri:      URI("place:folder=" + collsysID + "&OR"),
                anno:     this.SNOWL_COLLECTIONS_ANNO,
                parent:   collsysID,
                position: 0}; // 0=first
        collections.push(coll);

        // Build a map of all custom View folders and create the shortcuts,
        // initially this will just include the Custom entry included as sample.
        // XXX: in a Places rebuild scenario, order of View shortcuts will not be
        // maintained, as the rebuild will happen from the order of the base
        // folders - need to change order there if shortcuts dnd reordered.
        viewItems = PlacesUtils.annotations
                               .getItemsWithAnnotation(this.SNOWL_USER_VIEW_ANNO, {});
        for (var i=0; i < viewItems.length; i++) {
          name = PlacesUtils.bookmarks.getItemTitle(viewItems[i]).split(":")[1];
this._log.info("init: Restoring User View - " + name + " - " + viewItems[i]);
          coll = {property: "view",
                  itemId:   null,
                  value:    viewItems[i],
                  title:    name,
                  uri:      URI("place:folder=" + viewItems[i]),
                  anno:     this.SNOWL_USER_VIEWLIST_ANNO,
                  parent:   collsysID,
                  position: this.DEFAULT_INDEX};
          collections.push(coll);
        }
        // Add the collections.
        for each(let coll in collections) {
          coll.itemId = PlacesUtils.bookmarks.insertBookmark(coll.parent,
                                                             coll.uri,
                                                             coll.position,
                                                             coll.title);
          PlacesUtils.annotations.
                      setItemAnnotation(coll.itemId,
                                        this.SNOWL_PROPERTIES_ANNO,
                                        coll.property,
                                        0,
                                        this.EXPIRE_NEVER);
          // This  anno value must contain the itemId of the base folder if a
          // View shortcut, otherwise string for AllMessages shortcut.
          PlacesUtils.annotations.
                      setItemAnnotation(coll.itemId,
                                        coll.anno,
                                        coll.value,
                                        0,
                                        this.EXPIRE_NEVER);
        };

        PlacesUtils.bookmarks.insertSeparator(collsysID, 3);

        // Build the map.
        delete this.snowlPlacesQueries;
        this.snowlPlacesQueries = this.buildNameItemMap(this.SNOWL_COLLECTIONS_ANNO);
//      }
//    };

//    PlacesUtils.bookmarks.runInBatchMode(callback, null);

    this.setPlacesVersion(snowlPlacesRoot);
    this._placesInitialized = true;

    // Set the system root itemId.
    delete this.snowlPlacesFolderId;
    return this.snowlPlacesFolderId = snowlPlacesRoot;
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
function InstrumentedStorageStatement(sqlString, statement) {
  this._sqlString = sqlString;
  this._statement = Cc["@mozilla.org/storage/statement-wrapper;1"].
                    createInstance(Ci.mozIStorageStatementWrapper);
  this._statement.initialize(statement);
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

  initialize: function() {},

  get statement() { return this._statement.statement },
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

// Intialize places
SnowlPlaces.init();
