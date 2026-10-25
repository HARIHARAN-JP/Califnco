import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";

import {
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";

import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebaseConfig";

export default function DealerLoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert("Required", "Enter your email and password.");
      return;
    }

    setLoading(true);

    let signedIn = false;

    try {
      const result = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );

      signedIn = true;

      const userDoc = await getDoc(
        doc(db, "users", result.user.uid)
      );

      if (!userDoc.exists()) {
        await signOut(auth);
        signedIn = false;

        Alert.alert(
          "Access Denied",
          "Your user profile was not found. Please contact the administrator."
        );
        return;
      }

      const userData = userDoc.data();
      const role = String(userData.role || "")
        .trim()
        .toLowerCase();

      const status = String(userData.status || "")
        .trim()
        .toLowerCase();

      if (role !== "dealer") {
        await signOut(auth);
        signedIn = false;

        Alert.alert(
          "Access Denied",
          "This account is not registered as a dealer."
        );
        return;
      }

      if (status !== "approved") {
        await signOut(auth);
        signedIn = false;

        Alert.alert(
          "Approval Pending",
          "Your dealer account has not been approved yet. Please contact the administrator."
        );
        return;
      }

      Alert.alert(
        "Success",
        "Dealer login successful!"
      );

      // TODO: Navigate to the Dealer Dashboard here.
    } catch (error) {
      console.error("Dealer login error:", error);

      if (signedIn && auth.currentUser) {
        try {
          await signOut(auth);
        } catch (signOutError) {
          console.error("Sign-out error:", signOutError);
        }
      }

      if (error.code === "permission-denied") {
        Alert.alert(
          "Permission Denied",
          "The app cannot read your dealer profile. Check your Firestore security rules."
        );
      } else {
        Alert.alert(
          "Login Failed",
          error.code === "auth/invalid-credential"
            ? "Your email or password is incorrect."
            : error.message || "Please try again."
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>💧 Califnco</Text>

      <Text style={styles.title}>Dealer Login</Text>

      <Text style={styles.subtitle}>
        Access wholesale prices and bulk orders
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Dealer email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />

      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <TouchableOpacity
        style={[
          styles.button,
          loading && styles.buttonDisabled,
        ]}
        onPress={handleLogin}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.buttonText}>
            Login as Dealer
          </Text>
        )}
      </TouchableOpacity>

      <Text style={styles.footer}>
        Wholesale Products • Bulk Orders • Order History
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#F4F7FB",
  },
  logo: {
    fontSize: 30,
    fontWeight: "bold",
    color: "#155EEF",
    textAlign: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: "bold",
    color: "#172B4D",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: "#667085",
    textAlign: "center",
    marginTop: 8,
    marginBottom: 28,
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D0D5DD",
    borderRadius: 10,
    padding: 15,
    marginBottom: 16,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#155EEF",
    padding: 16,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "bold",
  },
  footer: {
    textAlign: "center",
    color: "#667085",
    marginTop: 24,
    fontSize: 12,
  },
});