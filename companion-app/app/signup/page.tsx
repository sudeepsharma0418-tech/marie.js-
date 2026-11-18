import AuthForm from "../AuthForm";
import { APP_NAME } from "@/lib/config";

export default function SignupPage() {
  return <AuthForm mode="signup" appName={APP_NAME} />;
}
