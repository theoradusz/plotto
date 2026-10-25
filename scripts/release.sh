#!/usr/bin/env bash
# Release in two steps, because main takes changes only through a reviewed pull request:
#   scripts/release.sh 0.3.0   checks, tests, sets the version, dates the changelog, builds the site, commits on release/v0.3.0,
#                              pushes that branch and opens the pull request page.
#   scripts/release.sh tag     after the merge: tags the new main as v0.3.0 and pushes the tag. The tag runs
#                              .github/workflows/release.yml, which publishes python-plotto to PyPI and plotto to npm.
# Run it from main with a clean tree and the Python environment of the repo active (or PYTHON=path/to/python).
set -euo pipefail
cd "$(dirname "$0")/.."

REPO=https://github.com/theoradusz/plotto
python=${PYTHON:-python}

fail() { echo "release: $*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }
version_of() { node -p 'require("./package.json").version'; }
# The lines of the "## Unreleased" section of CHANGELOG.md that are not empty and are not "###" headings.
unreleased() { awk '/^## /{on = ($2 == "Unreleased"); next} on && NF && !/^###/' CHANGELOG.md; }

on_synced_main() {
  [[ $(git branch --show-current) == main ]] || fail "switch to main first"
  [[ -z $(git status --porcelain) ]] || fail "commit or stash your changes first"
  git fetch --quiet --tags origin
  git merge --quiet --ff-only origin/main || fail "main has commits that are not on origin/main"
}

prepare() {
  local version=$1 tag="v$1" branch="release/v$1" current
  step "Checks"
  on_synced_main
  current=$(version_of)
  git rev-parse -q --verify "refs/tags/$tag" >/dev/null && fail "tag $tag already exists"
  git ls-remote --exit-code --heads origin "$branch" >/dev/null && fail "branch $branch is already on origin"
  node -e 'const [a, b] = process.argv.slice(1).map((v) => v.split(".").map(Number)); process.exit((a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) > 0 ? 0 : 1)' "$version" "$current" ||
    fail "$version is not above the current version $current"
  "$python" -c "import plotto, pytest, black, ruff" 2>/dev/null || fail "activate the repo's Python environment (pip install -e \"python[test]\") or set PYTHON"
  [[ -n $(unreleased) ]] || fail "CHANGELOG.md has no changes under \"## Unreleased\": write them first"
  echo "$current -> $version"

  step "Tests"
  npm test
  npm run browser-test
  "$python" -m pytest -q python/tests
  "$python" -m ruff check .
  "$python" -m black --check --quiet .

  step "Version $version on $branch"
  git switch --quiet -c "$branch"
  npm version "$version" --no-git-tag-version >/dev/null
  perl -pi -e "s/^__version__ = \".*\"/__version__ = \"$version\"/" python/plotto/__init__.py
  grep -q "__version__ = \"$version\"" python/plotto/__init__.py || fail "could not set __version__ in python/plotto/__init__.py"
  # The changes under "Unreleased" become the section of this version; a new empty "Unreleased" stays on top.
  perl -pi -e "s/^## Unreleased\$/## Unreleased\n\n## $version – $(date +%F)/" CHANGELOG.md

  step "Site"
  "$python" examples/build_site.py >/dev/null

  step "Commit and push $branch"
  git add package.json package-lock.json python/plotto/__init__.py CHANGELOG.md docs
  git commit --quiet -m "release $version"
  git push --quiet -u origin "$branch"
  git switch --quiet main

  local url="$REPO/compare/main...$branch?expand=1&title=release+$version"
  echo
  echo "Open the pull request: $url"
  command -v open >/dev/null && open "$url"
  echo "When it is merged, run:  scripts/release.sh tag"
}

tag() {
  local version tag
  step "Checks"
  on_synced_main
  version=$(version_of)
  tag="v$version"
  grep -q "__version__ = \"$version\"" python/plotto/__init__.py || fail "package.json ($version) and python/plotto/__init__.py differ"
  git rev-parse -q --verify "refs/tags/$tag" >/dev/null && fail "tag $tag already exists: merge a release pull request first (scripts/release.sh X.Y.Z)"
  git log --oneline -1

  echo
  read -r -p "Tag this commit as $tag and push the tag? This publishes $version to PyPI and npm. [y/N] " answer
  [[ $answer =~ ^[Yy]$ ]] || { echo "Nothing done."; exit 0; }
  git tag -a "$tag" -m "$tag"
  git push --quiet origin "$tag"
  echo "Pushed $tag. Follow the release: $REPO/actions"
  git push --quiet origin --delete "release/$tag" 2>/dev/null && echo "Deleted the branch release/$tag on origin." || true
  git branch --quiet -D "release/$tag" 2>/dev/null || true
}

case ${1:-} in
  tag) tag ;;
  [0-9]*.[0-9]*.[0-9]*) [[ $1 =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "usage: scripts/release.sh X.Y.Z | tag"; prepare "$1" ;;
  *) fail "usage: scripts/release.sh X.Y.Z (prepare the release pull request) | scripts/release.sh tag (after the merge)" ;;
esac
