import AuthForm from "../AuthForm";
import { APP_NAME } from "@/lib/config";

export default function LoginPage() {
  return <AuthForm mode="login" appName={APP_NAME} />;
}
