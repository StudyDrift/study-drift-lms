package cmd

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
)

var versionCmd = &cobra.Command{
	Use:         "version",
	Short:       "Print the lextures CLI version",
	Long:        "Print the semantic version and build commit of the lextures CLI.",
	Annotations: map[string]string{SkipAuthAnnotation: "true"},
	RunE: func(cmd *cobra.Command, args []string) error {
		if Cfg != nil && Cfg.JSON {
			return json.NewEncoder(cmd.OutOrStdout()).Encode(map[string]string{
				"version": Version,
				"commit":  BuildCommit,
			})
		}
		fmt.Fprintf(cmd.OutOrStdout(), "lextures %s (%s)\n", Version, BuildCommit)
		return nil
	},
}

func init() {
	rootCmd.AddCommand(versionCmd)
}
