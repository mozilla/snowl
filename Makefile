# ***** BEGIN LICENSE BLOCK *****
# Version: MPL 1.1/GPL 2.0/LGPL 2.1
#
# The contents of this file are subject to the Mozilla Public License Version
# 1.1 (the "License"); you may not use this file except in compliance with
# the License. You may obtain a copy of the License at
# http://www.mozilla.org/MPL/
#
# Software distributed under the License is distributed on an "AS IS" basis,
# WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
# for the specific language governing rights and limitations under the
# License.
#
# The Original Code is Weave code.
#
# The Initial Developer of the Original Code is
# Mozilla Corporation
# Portions created by the Initial Developer are Copyright (C) 2008
# the Initial Developer. All Rights Reserved.
#
# Contributor(s):
#   Dan Mills <thunder@mozilla.com> (original author)
#
# Alternatively, the contents of this file may be used under the terms of
# either the GNU General Public License Version 2 or later (the "GPL"), or
# the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
# in which case the provisions of the GPL or the LGPL are applicable instead
# of those above. If you wish to allow use of your version of this file only
# under the terms of either the GPL or the LGPL, and not to allow others to
# use your version of this file under the terms of the MPL, indicate your
# decision by deleting the provisions above and replace them with the notice
# and other provisions required by the GPL or the LGPL. If you do not delete
# the provisions above, a recipient may use your version of this file under
# the terms of any one of the MPL, the GPL or the LGPL.
#
# ***** END LICENSE BLOCK *****

site_url          := https://people.mozilla.com/~myk/snowl/
site_path_local   := website/
site_path_remote  := people.mozilla.com:/home/myk/public_html/snowl/

name              := $(shell perl -ane 'print $$1 if /<em:name>(.*)<\/em:name>/' install.rdf)
version           := $(shell perl -ane 'print $$1 if /<em:version>(.*)<\/em:version>/' install.rdf)

date              := $(shell date --utc +%Y%m%d%H%M)
revision_id       := $(shell hg tip --template '{node|short}')

# Development Channel
ifeq ($(channel),dev)
  # Development build updates are managed by the website, so we construct
  # an update URL that points to the update manifest we are going to create.
  update_name     := update-$(channel).rdf
  update_url      := $(site_url)$(update_name)
  update_url_tag  := <em:updateURL>$(update_url)</em:updateURL>
  package_version := $(version).99pre0t$(date)
  package_name    := $(name)-$(channel)-$(package_version).xpi
  package_url     := $(site_url)$(package_name)

# Release Channel
else ifeq ($(channel),rel)
  # Release build updates are managed by AMO, which provides its own update.
  update_name     := 
  update_url      := 
  update_url_tag  := 
  package_version := $(version)
  package_name    := $(name)-$(version).xpi
  package_url     := 

# No Channel
else
  # Builds without a channel don't update.
  update_name     := 
  update_url      := 
  update_url_tag  := 
  package_version := 0
  package_name    := $(name).xpi
  package_url     := 
endif

dotin_files := $(shell find . -type f -name \*.in)
dotin_files := $(dotin_files:.in=)
  $(error $(dotin_files))


all: package

.PHONY: package publish subscribe

# This creates a chrome.jar file for faster performance loading chrome files
# on startup.  We're not currently using this, but we should start doing so.
# But first we have to make it work (i.e. update chrome.manifest paths).
chrome_files      := content/* locale/* skin/*

chrome.jar: $(chrome_files)
	zip -ur chrome.jar $(chrome_files)

# FIXME: use a package manifest to determine which files to package.
package_files     := content locale skin modules defaults \
                     install.rdf chrome.manifest

substitute        := perl -p -e 's/@([^@]+)@/$$ENV{$$1} || $$&/ge'
export package_version update_url_tag package_url revision_id

package: $(package_files)
	mv install.rdf .\#install.rdf.bak
	mv defaults/preferences/prefs.js .\#prefs.js.bak
	$(substitute) install.rdf.in > install.rdf
	$(substitute) defaults/preferences/prefs.js.in > defaults/preferences/prefs.js
	zip -ur $(package_name) $(package_files) -x \*.in
	mv .\#install.rdf.bak install.rdf
	mv .\#prefs.js.bak defaults/preferences/prefs.js
	$(substitute) update.rdf.in > $(site_path_local)$(update_name)
ifneq ($(package_url),)
	mv $(package_name) $(site_path_local)
endif

publish:
	rsync -av $(site_path_local) $(site_path_remote)

help:
	@echo 'Targets:'
	@echo '  package:   build a XPI'
	@echo '  publish:   push files to the website'
	@echo '  clean'
	@echo
	@echo 'Variables:'
	@echo '  channel: "rel", "dev", or blank'
