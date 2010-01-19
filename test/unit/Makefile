# profiledir needs to be an absolute path on Mac OS X (FIXME: file bug).
profiledir = $(abspath ../profile)
sys := $(shell uname -s)

# OS detection

ifeq ($(sys), Darwin)
  os = Darwin
else
ifeq ($(sys), Linux)
  os = Linux
else
ifeq ($(sys), MINGW32_NT-6.0)
  os = WINNT
else
ifeq ($(sys), MINGW32_NT-5.1)
  os = WINNT
else
ifeq ($(sys), CYGWIN_NT-6.1-WOW64)
  os = WINNT
else
  $(error Sorry, your os is unknown/unsupported: $(sys))
endif
endif
endif
endif
endif

ifeq ($(topsrcdir),)
topsrcdir = ../..
endif

ifeq ($(native_topsrcdir),)
ifeq ($(os), WINNT)
native_topsrcdir = ..\..
else
native_topsrcdir = ../..
endif
endif

# The path to the extension, in the native format, as required by the extension
# manager when it installs an extension via a file in the <profile>/extensions/
# directory that contains the path to the extension.
ifeq ($(os), WINNT)
extensiondir = $(subst /,\,$(shell pwd -W))\$(native_topsrcdir)
else
extensiondir = `pwd`/$(topsrcdir)
endif

# A command that installs the extension into the profile when the harness
# creates a new profile.
configure_profile = echo "$(extensiondir)" > $(profiledir)/extensions/snowl@mozilla.org

include ../harness/Makefile
