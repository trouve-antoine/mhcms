# MHCMS: Minimal Headless CMS

## Overview

A very simple headless CMS that uses folder and markdown files instead of a database.
That means you can now use your favorite code editor instead of some irritating web GUI.
It supports the local file system and S3 out of the box. If you need more, you can implement
your own `IMhcmsFileAccess` class.

The publication date and short titles are stored inside file names. Other metadata and the body
of articles are stored inside the files themselves.
It is based on an indexing system, that is updated when needed. Still, it will be very slow
compared to a classic DB-based approach: think twice before using it.

Basic usage is illustrated in the sample code at `sample/read-blog.ts`.

## Specifications

Blog posts are markdown files with a header.
The file name must respect the naming convention `YYYYMMDD_a-short-title.md`, where:

- `YYYYMMDD` is day at which the article will be published.
  If the date is in the future, it will only be considered hidden unless this date
- `a-short-title` is the short title of the article, in kebab case.
  It is converted into a sentence by system, e.g. “A short title“.

The header consists of keys and values separated by a colon, one per line.
A header ends with a line that contains at least three hyphens.
Spaces around keys and values are ignored.
Keys can be specified in any case, but are converted to camel case.

These keys must be present in every blog post: title, subTitle, tags, authors.
Tags and authors are comma-separated lists of strings. Title and subTitle are strings.
Extra keys can be present, but you will need to provide a custom deserializer to parse the values.

Below is an article with the bare minimum

```20230822_a-bare-article.md
title: This is a test post
sub-title: Not much to say
tags:
authors:
---

This is the content of the article, in *markdown* syntax.
```

## The File Tree

Articles should be organized in one level of sub-folder, inside the root folder.
For example:

```
+ ./blog
  + drafts/
    20230820_Some-blog-post.md
  + published/
    00011225_Who-is-born.md
```

The example above uses sub-folder `drafts` and `published`, but it can be anything.
We call these sub-folders "collections".

At the root (e.g. the `./blog` folder in the example above), MHCMS will create an index
file with name `index.yaml`. It contains the list of paths together with their header data.
It is human-readable, but it is usually a bad idea to edit it by hand.
If you delete this file, you will need to re-generate it for the system to work.