package ingest

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"
)

// DetectedProject represents an auto-discovered project directory.
type DetectedProject struct {
	Name string
	Path string
}

// DetectProjects scans the given watch paths for git repositories
// and returns a list of detected projects with their root paths.
func DetectProjects(watchPaths []string, ignoreDirs []string) []DetectedProject {
	seen := make(map[string]bool)
	var projects []DetectedProject
	ignoreSet := make(map[string]bool, len(ignoreDirs))
	for _, d := range ignoreDirs {
		ignoreSet[d] = true
	}

	for _, root := range watchPaths {
		filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if d.IsDir() {
				name := d.Name()
				if ignoreSet[name] || (strings.HasPrefix(name, ".") && name != ".") {
					return filepath.SkipDir
				}
			}
			if d.IsDir() && d.Name() == ".git" {
				projectPath := filepath.Dir(path)
				if seen[projectPath] {
					return filepath.SkipDir
				}
				seen[projectPath] = true
				projectName := filepath.Base(projectPath)
				projects = append(projects, DetectedProject{
					Name: projectName,
					Path: projectPath,
				})
				slog.Debug("detected project", "name", projectName, "path", projectPath)
				return filepath.SkipDir
			}
			return nil
		})
	}
	return projects
}

// MatchPathToProject finds which project a file path belongs to.
// Returns the project path or "" if no match.
func MatchPathToProject(filePath string, projectPaths []string) string {
	// Pick the longest matching prefix for the most specific match.
	best := ""
	for _, pp := range projectPaths {
		if strings.HasPrefix(filePath, pp) && len(pp) > len(best) {
			best = pp
		}
	}
	return best
}

// MatchSessionToProject tries to match a session's metadata (project field or cwd)
// to a known project path. Returns project path or "".
func MatchSessionToProject(sessionProject string, sessionCwd string, projectPaths []string) string {
	// Try direct path match on cwd first.
	if sessionCwd != "" {
		if m := MatchPathToProject(sessionCwd, projectPaths); m != "" {
			return m
		}
	}
	// Try matching project field (could be a path or name).
	if sessionProject != "" {
		// Check if it's a path.
		if m := MatchPathToProject(sessionProject, projectPaths); m != "" {
			return m
		}
		// Check if the project name matches any known project's base name.
		for _, pp := range projectPaths {
			if filepath.Base(pp) == sessionProject {
				return pp
			}
		}
	}
	return ""
}
