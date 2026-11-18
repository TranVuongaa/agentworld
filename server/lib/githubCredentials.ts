import { managedCredentialsEnabled, managedRequest } from "./managedCredentials";

/** Obtain the owner's GitHub credential without placing it in the agent environment. */
export async function projectGithubToken(): Promise<string | null> {
  return managedCredentialsEnabled() ? managedRequest<string>("github") : null;
}
