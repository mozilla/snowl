// modules that come with Firefox

// modules that are generic
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/URI.js");

// Snowl-specific modules
Cu.import("resource://snowl/modules/collection.js");
Cu.import("resource://snowl/modules/feed.js");
Cu.import("resource://snowl/modules/message.js");
Cu.import("resource://snowl/modules/service.js");

let server;
let feed;
let refreshTime = new Date();

function run_test() {
  server = new nsHttpServer();
  let basePath = do_get_file("test/unit/");
  server.registerDirectory("/", basePath);
  server.start(8080);

  do_test_pending();

  Observers.add("snowl:subscribe:get:end", finish_test);
  feed = new SnowlFeed(null, null, new URI("http://localhost:8080/feed.xml"), undefined, null);
  feed.refresh(refreshTime);
}

function finish_test() {
  feed.persist();

  try {
    do_check_eq(SnowlService.accounts.length, 1);
    let account = SnowlService.accounts[0];
    do_check_eq(account.id.constructor.name, "Number");
    do_check_eq(account.constructor.name, "SnowlFeed");
    do_check_eq(account.name, "Example Feed");
    do_check_eq(account.machineURI.spec, "http://localhost:8080/feed.xml");
    do_check_eq(account.humanURI.spec, "http://example.org/");
    do_check_eq(account.username, null);
    do_check_eq(account.lastRefreshed.getTime(), refreshTime.getTime());
    do_check_eq(account.importance, null);
    do_check_eq(account.placeID.constructor.name, "Number");

    let collection = new SnowlCollection();
    let messages = collection.messages;
    do_check_eq(messages.length, 1);
    let message = messages[0];
    do_check_eq(message.id.constructor.name, "Number");
    do_check_eq(message.sourceID, account.id);
    do_check_eq(message.subject, "Atom-Powered Robots Run Amok");
    do_check_eq(message.authorName, "John Doe");
    // TODO: do_check_eq(message.authorID, authorID);
    // TODO: test that the message's author is a real identity record
    // with a real person record behind it and the values of those records
    // are all correct.
    do_check_eq(message.link, "http://example.org/2003/12/13/atom03");
    do_check_eq(message.timestamp.getTime(), 1071340202000);
    do_check_eq(message._read, false);
    do_check_eq(message.authorIcon, null);
    do_check_eq(message.received.constructor.name, "Date");
    do_check_eq(message.content, null);

    do_check_true(message.summary instanceof SnowlMessagePart);
    do_check_eq(message.summary.text, "Some text.");
    do_check_eq(message.summary.type, "text");
    do_check_eq(message.summary.base.spec, "http://localhost:8080/feed.xml");
    do_check_eq(message.summary.lang, null);
  }
  finally {
    server.stop();
    deleteDatabase();
    do_test_finished();
  }
}
