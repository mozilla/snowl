let SnowlView = {
  _getMessages: function(aMatchWords) {
    let conditions = [];

    if (aMatchWords)
      conditions.push("messages.id IN (SELECT messageID FROM parts WHERE content MATCH :matchWords)");

    let statementString = 
      "SELECT sources.title AS sourceTitle, subject, author, link, timestamp, content \
       FROM sources JOIN messages ON sources.id = messages.sourceID \
       JOIN parts on messages.id = parts.messageID";

    if (conditions.length > 0)
      statementString += " WHERE " + conditions.join(" AND ");

    statementString += " ORDER BY timestamp DESC";

    let statement = SnowlDatastore.createStatement(statementString);

    if (aMatchWords)
      statement.params.matchWords = aMatchWords;

    let messages = [];
    try {
      while (statement.step()) {
        let row = statement.row;
        messages.push({ sourceTitle: row.sourceTitle,
                        subject: row.subject,
                        author: row.author,
                        link: row.link,
                        timestamp: row.timestamp,
                        content: row.content });
      }
    }
    catch(ex) {
      dump(statementString + ": " + ex + ": " + SnowlDatastore.dbConnection.lastErrorString + "\n");
      throw ex;
    }
    finally {
      statement.reset();
    }

    return messages;
  },

  onLoad: function() {
    this._rebuildView();
  },
  
  onUpdate: function() {
    this._rebuildView();
  },

  onFilter: function() {
    let filterTextbox = document.getElementById("snowlFilterTextbox");
    this._rebuildView(filterTextbox.value);
  },

  _rebuildView: function(aMatchWords) {
    let tree = document.getElementById("snowlView");
    let children = tree.getElementsByTagName("treechildren")[0];

    // Empty the view.
    while (children.hasChildNodes())
      children.removeChild(children.lastChild);

    // Get the list of messages.
    let messages = this._getMessages(aMatchWords);

    let now = new Date().toLocaleDateString();

    for each (let message in messages) {
      let item = document.createElement("treeitem");
      item.link = message.link;
      let row = document.createElement("treerow");

      let authorCell = document.createElement("treecell");
      authorCell.setAttribute("label", message.author);

      let subjectCell = document.createElement("treecell");
      subjectCell.setAttribute("label", message.subject);

      let timestampCell = document.createElement("treecell");
      let timestamp = new Date(message.timestamp);
      let timestampLabel =
        timestamp.toLocaleDateString() == now ? timestamp.toLocaleTimeString()
                                              : timestamp.toLocaleString();
      timestampCell.setAttribute("label", timestampLabel);

      row.appendChild(authorCell);
      row.appendChild(subjectCell);
      row.appendChild(timestampCell);
      item.appendChild(row);
      children.appendChild(item);
    }
  },

  switchPosition: function() {
    let container = document.getElementById("snowlViewContainer");
    let splitter = document.getElementById("snowlViewSplitter");
    let browser = document.getElementById("browser");
    let content = document.getElementById("content");
    let appcontent = document.getElementById("appcontent");

    if (container.parentNode == appcontent) {
      browser.insertBefore(container, appcontent);
      browser.insertBefore(splitter, appcontent);
      splitter.setAttribute("orient", "horizontal");
    }
    else {
      appcontent.insertBefore(container, content);
      appcontent.insertBefore(splitter, content);
      splitter.setAttribute("orient", "vertical");
    }
  },

  onSelect: function(aEvent) {
    let tree = document.getElementById("snowlView");
    if (tree.currentIndex == -1)
      return;

    // When we support opening multiple links in the background,
    // perhaps use this code: http://lxr.mozilla.org/mozilla/source/browser/base/content/browser.js#1482

    let children = tree.getElementsByTagName("treechildren")[0];
    let link = children.childNodes[tree.currentIndex].link;
    openUILink(link, aEvent, false, false, false, null, null);
  }

};
