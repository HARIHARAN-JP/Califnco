import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import {
  createUserWithEmailAndPassword, onAuthStateChanged,
  signInWithEmailAndPassword, signOut, updateProfile, User,
} from "firebase/auth";
import {
  addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp,
  setDoc, where,
} from "firebase/firestore";
import { auth, db } from "./firebaseConfig";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

type Product = { id: string; name: string; price: number; image: string; description: string };
type OrderItem = { name: string; price: number; quantity: number };
type CustomerOrder = {
  id: string; items: OrderItem[]; totalAmount: number; status: string;
  createdAt?: { toDate: () => Date } | null;
};
type Screen = "home" | "details" | "cart" | "orders" | "service" | "profile";
type CartItems = Record<string, number>;
type LoginRole = "Customer" | "Dealer";

// Firestore may contain either "dealer" or "Dealer". Normalize role values
// before comparing them so capitalization does not block a valid login.
function normalizeRole(value: unknown): LoginRole | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "customer") return "Customer";
  if (normalized === "dealer") return "Dealer";
  return null;
}

function normalizeStatus(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isRegister, setIsRegister] = useState(false);
  const [loginRole, setLoginRole] = useState<LoginRole>("Customer");
  const [userRole, setUserRole] = useState<LoginRole | null>(null);
  const [roleError, setRoleError] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productError, setProductError] = useState("");
  const [screen, setScreen] = useState<Screen>("home");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartItems>({});
  const [placingOrder, setPlacingOrder] = useState(false);
  const [myOrders, setMyOrders] = useState<CustomerOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  const [serviceType, setServiceType] = useState("Regular Maintenance");
  const [serviceDate, setServiceDate] = useState("");
  const [serviceAddress, setServiceAddress] = useState("");
  const [servicePhone, setServicePhone] = useState("");
  const [serviceLoading, setServiceLoading] = useState(false);
  const [serviceRequestsLoading, setServiceRequestsLoading] = useState(false);
  const [serviceMessage, setServiceMessage] = useState("");
  const [serviceRequests, setServiceRequests] = useState<any[]>([]);

  // Customer profile
  const [profileName, setProfileName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [profileAddress, setProfileAddress] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);

  useEffect(() => onAuthStateChanged(auth, (currentUser) => {
    setUser(currentUser);
    if (!currentUser) {
      setUserRole(null);
      setRoleError("");
    }
    setCheckingAuth(false);
  }), []);

  // Restore the saved role when the app reopens with an existing Firebase session.
  useEffect(() => {
    if (!user || userRole) return;
    let cancelled = false;
    (async () => {
      try {
        const snapshot = await getDoc(doc(db, "users", user.uid));
        const userData = snapshot.exists() ? snapshot.data() : null;
        const savedRole = normalizeRole(userData?.role);
        const status = normalizeStatus(userData?.status);
        if (!cancelled && savedRole === "Dealer" && status !== "approved") {
          setUserRole(null);
          setRoleError(
            status === "rejected"
              ? "Your dealer account was rejected. Please contact the Califnco administrator."
              : "Your dealer account is not approved yet. Please wait for administrator approval."
          );
        } else if (!cancelled && savedRole) {
          setUserRole(savedRole);
          setRoleError("");
        } else if (!cancelled) {
          setRoleError("Your account role is missing or invalid. Ask the Califnco administrator to set Customer or Dealer in Firestore.");
        }
      } catch (error: any) {
        if (!cancelled) {
          setRoleError(error?.code === "permission-denied"
            ? "Firestore denied access to users/{uid}. Update your Firestore rules so a signed-in user can read only their own role document."
            : error?.message ?? "Could not verify your account role.");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user, userRole]);

  useEffect(() => {
    if (!user) {
      setProducts([]);
      return;
    }
    let cancelled = false;
    const loadProducts = async () => {
      setProductsLoading(true);
      setProductError("");
      try {
        const snapshot = await getDocs(query(
          collection(db, "products"), where("active", "==", true),
        ));
        const loaded: Product[] = snapshot.docs.map((item) => {
          const data = item.data();
          return {
            id: item.id,
            name: String(data.name ?? "Unnamed product"),
            price: Number(data.price ?? 0),
            image: String(data.image ?? ""),
            description: String(data.description ?? ""),
          };
        });
        if (!cancelled) setProducts(loaded);
      } catch (error) {
        console.error("Product loading error:", error);
        if (!cancelled) setProductError(
          "Could not load products. Check your internet connection and Firestore rules.",
        );
      } finally {
        if (!cancelled) setProductsLoading(false);
      }
    };
    loadProducts();
    return () => { cancelled = true; };
  }, [user, userRole]);

  const handleAuth = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password.trim()) {
      Alert.alert("Missing details", "Enter your email and password.");
      return;
    }
    if (isRegister && !name.trim()) {
      Alert.alert("Missing name", "Enter your full name.");
      return;
    }
    if (password.length < 6) {
      Alert.alert("Invalid password", "Your password must contain at least 6 characters.");
      return;
    }
    setAuthLoading(true);
    try {
      if (isRegister) {
        // Public registration is for customers only. Dealers should be added by an admin.
        if (loginRole !== "Customer") {
          Alert.alert("Dealer accounts", "Dealer accounts must be created by the Califnco administrator.");
          return;
        }
        const credential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        await updateProfile(credential.user, { displayName: name.trim() });
        await setDoc(doc(db, "users", credential.user.uid), {
          uid: credential.user.uid,
          name: name.trim(),
          email: cleanEmail,
          role: "Customer",
          createdAt: serverTimestamp(),
        });
        setUserRole("Customer");
        setRoleError("");
        Alert.alert("Welcome!", "Your customer account has been created.");
      } else {
        const credential = await signInWithEmailAndPassword(auth, cleanEmail, password);
        let actualRole: LoginRole | null = null;
        let accountStatus = "";
        try {
          const userSnapshot = await getDoc(doc(db, "users", credential.user.uid));
          if (userSnapshot.exists()) {
            const userData = userSnapshot.data();
            actualRole = normalizeRole(userData.role);
            accountStatus = normalizeStatus(userData.status);
          }
        } catch (roleReadError: any) {
          await signOut(auth);
          const details = roleReadError?.code === "permission-denied"
            ? "Firebase login worked, but Firestore blocked reading your role. Update the Firestore rules shown below the code and publish them."
            : roleReadError?.message ?? "Could not read your account role.";
          Alert.alert("Role verification failed", details);
          return;
        }

        // Verify the normalized role from Firestore; the selected button alone never grants access.
        if (actualRole !== loginRole) {
          await signOut(auth);
          setUserRole(null);
          Alert.alert(
            "Access denied",
            actualRole
              ? `This account is registered as ${actualRole}, not ${loginRole}. Select the correct login type.`
              : "This account has no valid role record. Ask the Califnco administrator to set its role in Firestore.",
          );
          return;
        }

        // Dealer access is allowed only after the administrator sets status to "approved".
        if (actualRole === "Dealer" && accountStatus !== "approved") {
          await signOut(auth);
          setUserRole(null);
          const statusMessage = accountStatus === "rejected"
            ? "Your dealer account was rejected. Please contact the Califnco administrator."
            : "Your dealer account is not approved yet. Please wait for administrator approval.";
          Alert.alert("Dealer account not approved", statusMessage);
          return;
        }

        setUserRole(actualRole);
        setRoleError("");
      }
      setPassword("");
    } catch (error: any) {
      const messages: Record<string, string> = {
        "auth/email-already-in-use": "This email is already registered. Please log in.",
        "auth/invalid-email": "Please enter a valid email address.",
        "auth/invalid-credential": "Incorrect email or password. Please try again.",
        "auth/weak-password": "Please choose a stronger password with at least 6 characters.",
        "auth/network-request-failed": "Network error. Check your internet connection.",
        "auth/too-many-requests": "Too many attempts. Please try again later.",
      };
      Alert.alert("Authentication failed", messages[error.code] ?? error.message ?? "Something went wrong.");
    } finally {
      setAuthLoading(false);
    }
  };

  const testNotification = async () => {
    try {
      if (!Device.isDevice) {
        Alert.alert("Physical device required", "Please test notifications on your Android phone, not an emulator.");
        return;
      }

      const permission = await Notifications.getPermissionsAsync();
      let status = permission.status;
      if (status !== "granted") {
        const requested = await Notifications.requestPermissionsAsync();
        status = requested.status;
      }

      if (status !== "granted") {
        Alert.alert("Permission required", "Please allow Califnco to send notifications in your phone settings.");
        return;
      }

      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "Califnco notifications",
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#0878D1",
        });
      }

      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Califnco",
          body: "Notifications are enabled on your device!",
          sound: "default",
        },
        trigger: null,
      });
    } catch (error: any) {
      console.error("Notification test error:", error);
      Alert.alert("Notification error", error?.message ?? "Could not send the test notification.");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setCart({});
      setScreen("home");
      setSelectedProduct(null);
      setUserRole(null);
      setEmail("");
      setPassword("");
    } catch (error) {
      console.error("Logout error:", error);
      Alert.alert("Error", "Could not log out. Please try again.");
    }
  };

  const addToCart = (product: Product) => {
    setCart((previous) => ({ ...previous, [product.id]: (previous[product.id] ?? 0) + 1 }));
    Alert.alert("Added to cart", `${product.name} added successfully.`);
  };

  const changeQuantity = (productId: string, change: number) => {
    setCart((previous) => {
      const nextQuantity = (previous[productId] ?? 0) + change;
      if (nextQuantity <= 0) {
        const updated = { ...previous };
        delete updated[productId];
        return updated;
      }
      return { ...previous, [productId]: nextQuantity };
    });
  };

  // Dealers receive a 10% discount; customers pay the normal product price.
  const getProductPrice = (product: Product) =>
    userRole === "Dealer" ? product.price * 0.9 : product.price;
  const cartProducts = products.filter((product) => (cart[product.id] ?? 0) > 0);
  const cartCount = Object.values(cart).reduce((total, quantity) => total + quantity, 0);
  const totalAmount = cartProducts.reduce(
    (total, product) => total + getProductPrice(product) * (cart[product.id] ?? 0), 0,
  );

  const handlePlaceOrder = async () => {
    if (!user) return Alert.alert("Login required", "Please log in first.");
    if (placingOrder) return;
    if (!cartProducts.length) return Alert.alert("Empty cart", "Please add products to your cart.");
    const items = cartProducts.map((product) => ({
      productId: product.id, name: product.name, price: getProductPrice(product),
      quantity: cart[product.id], image: product.image,
    }));
    setPlacingOrder(true);
    try {
      const orderRef = await addDoc(collection(db, "orders"), {
        userId: user.uid,
        accountRole: userRole ?? "Customer",
        customerEmail: user.email ?? "",
        customerName: user.displayName ?? "",
        items, totalAmount,
        orderType: userRole === "Dealer" ? "Wholesale/Bulk" : "Retail",
        status: "Pending", createdAt: serverTimestamp(),
      });
      setCart({});
      setScreen("home");
      Alert.alert(
        "Order placed successfully!",
        `Your order has been saved.\n\nOrder ID:\n${orderRef.id}\n\nTotal: ₹${totalAmount.toLocaleString("en-IN")}\n\nStatus: Pending`,
      );
    } catch (error: any) {
      console.error("Order placement error:", error);
      Alert.alert("Order failed", `${error.code ?? "unknown-error"}\n${error.message ?? "No error details"}`);
    } finally {
      setPlacingOrder(false);
    }
  };

  const loadMyOrders = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return Alert.alert("Login required", "Please log in to view your orders.");
    setOrdersLoading(true);
    try {
      const snapshot = await getDocs(query(
        collection(db, "orders"), where("userId", "==", currentUser.uid),
      ));
      const fetched: CustomerOrder[] = snapshot.docs.map((orderDoc) => {
        const data = orderDoc.data();
        return {
          id: orderDoc.id,
          items: Array.isArray(data.items) ? data.items : [],
          totalAmount: Number(data.totalAmount ?? 0),
          status: String(data.status ?? "Pending"),
          createdAt: data.createdAt ?? null,
        };
      });
      fetched.sort((a, b) => (b.createdAt?.toDate().getTime() ?? 0) - (a.createdAt?.toDate().getTime() ?? 0));
      setMyOrders(fetched);
      setScreen("orders");
    } catch (error: any) {
      Alert.alert("Could not load orders", error.message ?? "Check Firestore rules and internet connection.");
    } finally {
      setOrdersLoading(false);
    }
  };

  const loadMyServiceRequests = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return Alert.alert("Login required", "Please log in to view service requests.");
    setServiceRequestsLoading(true);
    setServiceMessage("");
    try {
      const snapshot = await getDocs(query(
        collection(db, "serviceRequests"), where("userId", "==", currentUser.uid),
      ));
      const fetched = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      fetched.sort((a: any, b: any) =>
        (b.createdAt?.toDate?.().getTime?.() ?? 0) - (a.createdAt?.toDate?.().getTime?.() ?? 0));
      setServiceRequests(fetched);
      setScreen("service");
    } catch (error: any) {
      setServiceMessage(error?.code === "permission-denied"
        ? "Permission denied. Check the serviceRequests read rule in Firestore."
        : error?.message ?? "Could not load service requests.");
    } finally {
      setServiceRequestsLoading(false);
    }
  };

  const handleBookService = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return Alert.alert("Login required", "Please log in before booking a service.");
    if (!serviceDate.trim() || !serviceAddress.trim() || !servicePhone.trim()) {
      setServiceMessage("Please complete the date, address and phone fields.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate.trim())) {
      setServiceMessage("Enter the date in YYYY-MM-DD format.");
      return;
    }
    const [year, month, day] = serviceDate.trim().split("-").map(Number);
    const chosenDate = new Date(year, month - 1, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (Number.isNaN(chosenDate.getTime()) || chosenDate < today ||
      chosenDate.getFullYear() !== year || chosenDate.getMonth() + 1 !== month ||
      chosenDate.getDate() !== day) {
      setServiceMessage("Please choose a valid date today or later.");
      return;
    }
    if (servicePhone.replace(/\D/g, "").length < 10) {
      setServiceMessage("Enter a valid contact number with at least 10 digits.");
      return;
    }
    setServiceLoading(true);
    setServiceMessage("");
    try {
      const requestRef = await addDoc(collection(db, "serviceRequests"), {
        userId: currentUser.uid, customerEmail: currentUser.email ?? "",
        customerName: currentUser.displayName ?? "", serviceType,
        serviceDate: serviceDate.trim(), serviceAddress: serviceAddress.trim(),
        servicePhone: servicePhone.trim(), status: "Pending", createdAt: serverTimestamp(),
      });
      setServiceMessage(`Service request submitted. Reference: ${requestRef.id}`);
      setServiceDate("");
      setServiceAddress("");
      setServicePhone("");
      const snapshot = await getDocs(query(
        collection(db, "serviceRequests"), where("userId", "==", currentUser.uid),
      ));
      setServiceRequests(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    } catch (error: any) {
      setServiceMessage(error?.code === "permission-denied"
        ? "Permission denied. Add the serviceRequests rule to Firestore and publish it."
        : error?.message ?? "Could not submit the service request. Please try again.");
    } finally {
      setServiceLoading(false);
    }
  };

  const loadCustomerProfile = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return Alert.alert("Login required", "Please log in first.");
    setProfileLoading(true);
    setScreen("profile");
    try {
      const snapshot = await getDoc(doc(db, "customerProfiles", currentUser.uid));
      const data = snapshot.exists() ? snapshot.data() : {};
      setProfileName(String(data.name ?? currentUser.displayName ?? ""));
      setProfilePhone(String(data.phone ?? ""));
      setProfileAddress(String(data.address ?? ""));
    } catch (error: any) {
      console.error("Profile loading error:", error);
      Alert.alert("Profile error", error.message ?? "Could not load your profile.");
    } finally {
      setProfileLoading(false);
    }
  };

  const saveCustomerProfile = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return Alert.alert("Login required", "Please log in first.");
    if (!profileName.trim()) return Alert.alert("Name required", "Please enter your full name.");
    if (profilePhone.replace(/\D/g, "").length < 10) {
      return Alert.alert("Invalid phone", "Enter a valid phone number with at least 10 digits.");
    }
    if (!profileAddress.trim()) return Alert.alert("Address required", "Please enter your address.");
    setProfileSaving(true);
    try {
      await setDoc(doc(db, "customerProfiles", currentUser.uid), {
        userId: currentUser.uid,
        name: profileName.trim(),
        email: currentUser.email ?? "",
        phone: profilePhone.trim(),
        address: profileAddress.trim(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      if (currentUser.displayName !== profileName.trim()) {
        await updateProfile(currentUser, { displayName: profileName.trim() });
        setUser({ ...currentUser });
      }
      Alert.alert("Success", "Your profile has been saved.");
    } catch (error: any) {
      console.error("Profile saving error:", error);
      Alert.alert("Save failed", error.message ?? "Could not save profile. Check Firestore rules.");
    } finally {
      setProfileSaving(false);
    }
  };

  if (checkingAuth) return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color="#0878D1" />
      <Text style={styles.loadingText}>Loading Califnco...</Text>
    </View>
  );

  if (user && !userRole) return (
    <View style={styles.centered}>
      {roleError ? <>
        <Text style={styles.errorText}>{roleError}</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={handleLogout}>
          <Text style={styles.primaryButtonText}>Sign out</Text>
        </TouchableOpacity>
      </> : <>
        <ActivityIndicator size="large" color="#0878D1" />
        <Text style={styles.loadingText}>Verifying your Califnco account...</Text>
      </>}
    </View>
  );

  if (!user) return (
    <KeyboardAvoidingView style={styles.authContainer}
      behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.authContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>💧 Califnco</Text>
        <Text style={styles.authTitle}>{isRegister ? "Create Account" : "Welcome Back"}</Text>
        <Text style={styles.authSubtitle}>
          {isRegister
            ? "Create your customer account to shop with Califnco."
            : "Choose how you want to sign in."}
        </Text>

        {!isRegister && <>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ selected: loginRole === "Customer" }}
            style={[styles.roleButton, loginRole === "Customer" && styles.roleButtonActive]}
            onPress={() => setLoginRole("Customer")}
          >
            <Text style={styles.roleEmoji}>🛍️</Text>
            <View style={styles.roleTextContainer}>
              <Text style={styles.roleTitle}>Customer Login</Text>
              <Text style={styles.roleDescription}>Shop products and manage your orders</Text>
            </View>
            <Text style={styles.roleArrow}>{loginRole === "Customer" ? "✓" : "›"}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ selected: loginRole === "Dealer" }}
            style={[styles.roleButton, loginRole === "Dealer" && styles.roleButtonActive]}
            onPress={() => setLoginRole("Dealer")}
          >
            <Text style={styles.roleEmoji}>🏪</Text>
            <View style={styles.roleTextContainer}>
              <Text style={styles.roleTitle}>Dealer Login</Text>
              <Text style={styles.roleDescription}>Sign in with an administrator-created dealer account</Text>
            </View>
            <Text style={styles.roleArrow}>{loginRole === "Dealer" ? "✓" : "›"}</Text>
          </TouchableOpacity>
        </>}

        {isRegister && <TextInput style={styles.input} placeholder="Full name"
          value={name} onChangeText={setName} autoCapitalize="words" />}
        <TextInput style={styles.input} placeholder="Email address" value={email}
          onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
        <TextInput style={styles.input} placeholder="Password (minimum 6 characters)"
          value={password} onChangeText={setPassword} secureTextEntry />
        <TouchableOpacity style={[styles.primaryButton, authLoading && styles.disabledButton]}
          onPress={handleAuth} disabled={authLoading}>
          {authLoading ? <ActivityIndicator color="#FFFFFF" /> :
            <Text style={styles.primaryButtonText}>{isRegister ? "Create Customer Account" : `Login as ${loginRole}`}</Text>}
        </TouchableOpacity>
        {loginRole === "Customer" && <TouchableOpacity
          onPress={() => { setIsRegister((previous) => !previous); setPassword(""); }}
          style={styles.switchAuthButton}>
          <Text style={styles.switchAuthText}>
            {isRegister ? "Already have an account? Login" : "New customer? Create an account"}
          </Text>
        </TouchableOpacity>}
        {loginRole === "Dealer" && !isRegister && <Text style={styles.dealerNote}>
          Dealer accounts are created by the Califnco administrator. Customer registration is not available in Dealer mode.
        </Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.logoSmall}>💧 Califnco</Text>
            <Text style={styles.headerSubtitle}>{userRole === "Dealer" ? "Dealer wholesale portal" : "Pure water, better living"}</Text>
          </View>
          <View style={styles.headerActions}>
            {userRole === "Customer" && <TouchableOpacity
              accessibilityLabel="Test notification"
              style={styles.roundHeaderButton}
              onPress={testNotification}
            >
              <Text style={styles.roundHeaderIcon}>🔔</Text>
            </TouchableOpacity>}
            {userRole === "Customer" && <TouchableOpacity
              accessibilityLabel="Open customer profile"
              style={[styles.roundHeaderButton, screen === "profile" && styles.roundHeaderButtonActive]}
              onPress={loadCustomerProfile}
              disabled={profileLoading}
            >
              <Text style={styles.roundHeaderIcon}>👤</Text>
            </TouchableOpacity>}
            {userRole === "Dealer" && <TouchableOpacity style={styles.logoutHeaderButton} onPress={handleLogout}>
              <Text style={styles.logoutText}>Logout</Text>
            </TouchableOpacity>}
          </View>
        </View>
        <Text style={styles.helloText}>{userRole === "Dealer" ? "Dealer account: " : "Hello, "}{user.displayName || user.email || "Customer"}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.navigation}>
            {(userRole === "Dealer" ? [
              { key: "home", label: "Wholesale Products", action: () => setScreen("home") },
              { key: "cart", label: `Bulk Order (${cartCount})`, action: () => setScreen("cart") },
              { key: "orders", label: ordersLoading ? "Loading..." : "Dealer Order History", action: loadMyOrders },
            ] : [
              { key: "home", label: "Products", action: () => setScreen("home") },
              { key: "cart", label: `Cart (${cartCount})`, action: () => setScreen("cart") },
              { key: "orders", label: ordersLoading ? "Loading..." : "My Orders", action: loadMyOrders },
              { key: "service", label: serviceRequestsLoading ? "Loading..." : "Service", action: loadMyServiceRequests },
            ] as { key: Screen; label: string; action: () => void }[]).map((item) => (
              <TouchableOpacity key={item.key}
                style={[styles.navButton, screen === item.key && styles.navButtonActive]}
                onPress={item.action}
                disabled={(item.key === "orders" && ordersLoading) ||
                  (item.key === "service" && serviceRequestsLoading)}>
                <Text style={[styles.navText, screen === item.key && styles.navTextActive]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>

      <ScrollView style={styles.mainScroll} contentContainerStyle={styles.mainContent}
        keyboardShouldPersistTaps="handled">
        {screen === "home" && <View>
          <Text style={styles.sectionTitle}>{userRole === "Dealer" ? "Wholesale Products" : "Our Products"}</Text>
          <Text style={styles.sectionSubtitle}>{userRole === "Dealer"
            ? "Order products in bulk at your dealer price. Add quantities to your bulk order and track its status in Dealer Order History."
            : "Find the right purifier for your home."}</Text>
          {userRole === "Dealer" && <View style={styles.dealerBanner}>
            <Text style={styles.dealerBannerTitle}>Dealer Portal</Text>
            <Text style={styles.dealerBannerText}>Dealer prices are calculated automatically as 10% less than the normal price.</Text>
          </View>}
          {productsLoading && <ActivityIndicator size="large" color="#0878D1" style={styles.loader} />}
          {!!productError && <View style={styles.messageCard}><Text style={styles.errorText}>{productError}</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={() => {
              setProductsLoading(true);
              (async () => {
                try {
                  const snapshot = await getDocs(query(collection(db, "products"), where("active", "==", true)));
                  setProducts(snapshot.docs.map((item) => {
                    const data = item.data();
                    return { id: item.id, name: String(data.name ?? "Unnamed product"),
                      price: Number(data.price ?? 0),
                      image: String(data.image ?? ""), description: String(data.description ?? "") };
                  }));
                  setProductError("");
                } catch (error: any) {
                  Alert.alert("Retry failed", error.message ?? "Could not reload products.");
                } finally {
                  setProductsLoading(false);
                }
              })();
            }}><Text style={styles.primaryButtonText}>Retry loading</Text></TouchableOpacity>
          </View>}
          {!productsLoading && !productError && products.length === 0 && <View style={styles.messageCard}>
            <Text style={styles.emptyText}>No active products found.</Text>
            <Text style={styles.mutedText}>Check your products collection and make sure active is set to true.</Text>
          </View>}
          <View style={styles.productList}>{products.map((product) => <View key={product.id} style={styles.productCard}>
            {product.image ? <Image source={{ uri: product.image }} style={styles.productImage} resizeMode="cover" /> :
              <View style={styles.imagePlaceholder}><Text style={styles.placeholderText}>💧</Text></View>}
            <View style={styles.productInfo}>
              <Text style={styles.productName}>{product.name}</Text>
              <Text style={styles.productPrice}>{userRole === "Dealer" ? "Dealer price: " : ""}₹{getProductPrice(product).toLocaleString("en-IN")}</Text>
              <Text style={styles.productDescription} numberOfLines={2}>{product.description}</Text>
              <View style={styles.productActions}>
                <TouchableOpacity style={styles.outlineButton} onPress={() => {
                  setSelectedProduct(product); setScreen("details");
                }}><Text style={styles.outlineButtonText}>Details</Text></TouchableOpacity>
                <TouchableOpacity style={styles.smallPrimaryButton} onPress={() => addToCart(product)}>
                  <Text style={styles.primaryButtonText}>Add to Cart</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>)}</View>
        </View>}

        {screen === "details" && selectedProduct && <View style={styles.detailsCard}>
          {selectedProduct.image ? <Image source={{ uri: selectedProduct.image }} style={styles.detailsImage} resizeMode="cover" /> :
            <View style={styles.detailsImagePlaceholder}><Text style={styles.placeholderText}>💧</Text></View>}
          <Text style={styles.sectionTitle}>{selectedProduct.name}</Text>
          <Text style={styles.detailsPrice}>{userRole === "Dealer" ? "Dealer price: " : ""}₹{getProductPrice(selectedProduct).toLocaleString("en-IN")}</Text>
          <Text style={styles.detailsDescription}>{selectedProduct.description || "Quality water purifier for your home."}</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => addToCart(selectedProduct)}>
            <Text style={styles.primaryButtonText}>Add to Cart</Text></TouchableOpacity>
          <TouchableOpacity style={styles.outlineButtonFull} onPress={() => setScreen("home")}>
            <Text style={styles.outlineButtonText}>Back to Products</Text></TouchableOpacity>
        </View>}

        {screen === "cart" && <View>
          <Text style={styles.sectionTitle}>{userRole === "Dealer" ? "Bulk Order" : "Your Shopping Cart"}</Text>
          {!cartProducts.length ? <View style={styles.messageCard}>
            <Text style={styles.emptyText}>Your cart is empty.</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={() => setScreen("home")}>
              <Text style={styles.primaryButtonText}>Browse Products</Text></TouchableOpacity>
          </View> : <>
            {cartProducts.map((product) => <View key={product.id} style={styles.cartItem}>
              {product.image ? <Image source={{ uri: product.image }} style={styles.cartImage} resizeMode="cover" /> :
                <View style={styles.cartImagePlaceholder}><Text>💧</Text></View>}
              <View style={styles.cartItemInfo}>
                <Text style={styles.productName}>{product.name}</Text>
                <Text style={styles.productPrice}>₹{getProductPrice(product).toLocaleString("en-IN")}</Text>
                <View style={styles.quantityRow}>
                  <TouchableOpacity style={styles.quantityButton} onPress={() => changeQuantity(product.id, -1)}>
                    <Text style={styles.quantityButtonText}>−</Text></TouchableOpacity>
                  <Text style={styles.quantityText}>{cart[product.id]}</Text>
                  <TouchableOpacity style={styles.quantityButton} onPress={() => changeQuantity(product.id, 1)}>
                    <Text style={styles.quantityButtonText}>+</Text></TouchableOpacity>
                </View>
              </View>
              <Text style={styles.itemTotal}>₹{(getProductPrice(product) * cart[product.id]).toLocaleString("en-IN")}</Text>
            </View>)}
            <View style={styles.totalCard}>
              <View style={styles.totalRow}><Text style={styles.totalLabel}>Total Items</Text><Text style={styles.totalValue}>{cartCount}</Text></View>
              <View style={styles.totalRow}><Text style={styles.totalLabel}>Total Amount</Text><Text style={styles.totalAmount}>₹{totalAmount.toLocaleString("en-IN")}</Text></View>
              <Text style={styles.mutedText}>{userRole === "Dealer" ? "Review bulk quantities before submitting. The order will be saved with Pending status for dealer processing." : "Payment is not collected in this demo. Your order will be saved with Pending status."}</Text>
              <TouchableOpacity style={[styles.primaryButton, placingOrder && styles.disabledButton]}
                onPress={handlePlaceOrder} disabled={placingOrder}>
                {placingOrder ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>{userRole === "Dealer" ? "Submit Bulk Order" : "Place Order"}</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.outlineButtonFull} onPress={() => setScreen("home")}>
                <Text style={styles.outlineButtonText}>Continue Shopping</Text></TouchableOpacity>
            </View>
          </>}
        </View>}

        {userRole === "Customer" && screen === "service" && <View>
          <Text style={styles.sectionTitle}>Book a Service</Text>
          <Text style={styles.sectionSubtitle}>Schedule maintenance, installation, filter replacement or repair.</Text>
          <View style={styles.serviceFormCard}>
            <Text style={styles.formLabel}>Service type</Text>
            {["Regular Maintenance", "Filter Replacement", "Water Purifier Repair", "Installation"].map((type) =>
              <TouchableOpacity key={type} style={[styles.serviceOption, serviceType === type && styles.serviceOptionSelected]}
                onPress={() => setServiceType(type)}>
                <Text style={[styles.serviceOptionText, serviceType === type && styles.serviceOptionTextSelected]}>
                  {serviceType === type ? "●  " : "○  "}{type}</Text>
              </TouchableOpacity>)}
            <Text style={styles.formLabel}>Preferred date (YYYY-MM-DD)</Text>
            <TextInput style={styles.input} value={serviceDate} onChangeText={setServiceDate} placeholder="2026-11-05" />
            <Text style={styles.formLabel}>Service address</Text>
            <TextInput style={[styles.input, styles.multilineInput]} value={serviceAddress}
              onChangeText={setServiceAddress} placeholder="Enter the full service address" multiline textAlignVertical="top" />
            <Text style={styles.formLabel}>Contact phone</Text>
            <TextInput style={styles.input} value={servicePhone} onChangeText={setServicePhone}
              placeholder="10-digit phone number" keyboardType="phone-pad" />
            {!!serviceMessage && <Text style={styles.serviceMessage}>{serviceMessage}</Text>}
            <TouchableOpacity style={[styles.primaryButton, serviceLoading && styles.disabledButton]}
              onPress={handleBookService} disabled={serviceLoading}>
              {serviceLoading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Submit Service Request</Text>}
            </TouchableOpacity>
          </View>
          <View style={styles.serviceHistoryHeader}>
            <Text style={styles.sectionTitle}>My Service Requests</Text>
            <TouchableOpacity style={styles.outlineButton} onPress={loadMyServiceRequests} disabled={serviceRequestsLoading}>
              <Text style={styles.outlineButtonText}>{serviceRequestsLoading ? "Loading..." : "Refresh"}</Text>
            </TouchableOpacity>
          </View>
          {serviceRequestsLoading ? <ActivityIndicator size="large" color="#0878D1" style={styles.loader} /> :
            serviceRequests.length === 0 ? <View style={styles.messageCard}>
              <Text style={styles.emptyText}>No service requests yet.</Text>
              <Text style={styles.mutedText}>Requests you submit will appear here with their current status.</Text>
            </View> : <View style={styles.productList}>{serviceRequests.map((request: any) =>
              <View key={request.id} style={styles.orderCard}>
                <Text style={styles.productName}>{request.serviceType}</Text>
                <Text style={styles.mutedText}>Reference: {request.id}</Text>
                <Text style={styles.orderItem}>Preferred date: {request.serviceDate}</Text>
                <Text style={styles.orderItem}>Address: {request.serviceAddress}</Text>
                <Text style={styles.orderItem}>Phone: {request.servicePhone}</Text>
                <Text style={styles.orderStatus}>Status: {request.status ?? "Pending"}</Text>
              </View>)}</View>}
        </View>}

        {userRole === "Customer" && screen === "profile" && <View>
          <Text style={styles.sectionTitle}>My Profile</Text>
          <Text style={styles.sectionSubtitle}>View and update your customer details.</Text>
          {profileLoading ? <ActivityIndicator size="large" color="#0878D1" style={styles.loader} /> :
            <View style={styles.serviceFormCard}>
              <Text style={styles.formLabel}>Full name</Text>
              <TextInput style={styles.input} value={profileName} onChangeText={setProfileName}
                placeholder="Enter your full name" autoCapitalize="words" />
              <Text style={styles.formLabel}>Email address</Text>
              <TextInput style={[styles.input, styles.readOnlyInput]} value={user.email ?? ""} editable={false} />
              <Text style={styles.mutedText}>Your email is linked to your login account.</Text>
              <Text style={styles.formLabel}>Phone number</Text>
              <TextInput style={styles.input} value={profilePhone} onChangeText={setProfilePhone}
                placeholder="Enter your phone number" keyboardType="phone-pad" />
              <Text style={styles.formLabel}>Address</Text>
              <TextInput style={[styles.input, styles.multilineInput]} value={profileAddress}
                onChangeText={setProfileAddress} placeholder="Enter your full address" multiline textAlignVertical="top" />
              <TouchableOpacity style={[styles.primaryButton, profileSaving && styles.disabledButton]}
                onPress={saveCustomerProfile} disabled={profileSaving}>
                {profileSaving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Save Profile</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.outlineButtonFull} onPress={() => setScreen("home")}>
                <Text style={styles.outlineButtonText}>Back to Products</Text></TouchableOpacity>
              <TouchableOpacity style={styles.logoutButtonFull} onPress={handleLogout}>
                <Text style={styles.logoutButtonText}>Logout</Text>
              </TouchableOpacity>
            </View>}
        </View>}

        {screen === "orders" && <View>
          <Text style={styles.sectionTitle}>{userRole === "Dealer" ? "Dealer Order History" : "My Orders"}</Text>
          <Text style={styles.sectionSubtitle}>{userRole === "Dealer" ? "Track your submitted wholesale and bulk orders." : "View your previous purchases and order status."}</Text>
          {ordersLoading ? <ActivityIndicator size="large" color="#0878D1" style={styles.loader} /> :
            myOrders.length === 0 ? <View style={styles.messageCard}>
              <Text style={styles.emptyText}>No orders yet.</Text>
              <Text style={styles.mutedText}>Orders you place will appear here.</Text>
              <TouchableOpacity style={styles.primaryButton} onPress={() => setScreen("home")}>
                <Text style={styles.primaryButtonText}>Browse Products</Text></TouchableOpacity>
            </View> : <View style={styles.productList}>{myOrders.map((order) =>
              <View key={order.id} style={styles.orderCard}>
                <Text style={styles.productName}>Order details</Text>
                <Text style={styles.mutedText}>Order ID: {order.id}</Text>
                <Text style={styles.mutedText}>Date: {order.createdAt ? order.createdAt.toDate().toLocaleDateString() : "Processing"}</Text>
                <View style={styles.orderDivider} />
                {order.items.map((item, index) => <Text key={`${order.id}-${index}`} style={styles.orderItem}>
                  {item.name} × {item.quantity} — ₹{(Number(item.price) * Number(item.quantity)).toLocaleString("en-IN")}
                </Text>)}
                <Text style={styles.totalAmount}>Total: ₹{order.totalAmount.toLocaleString("en-IN")}</Text>
                <Text style={styles.orderStatus}>Status: {order.status}</Text>
              </View>)}</View>}
        </View>}
      </ScrollView>
      <View style={styles.footer}><Text style={styles.footerText}>Califnco Water Purifier Store</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F3F8FC" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F3F8FC" },
  loadingText: { marginTop: 12, color: "#526579" },
  authContainer: { flex: 1, backgroundColor: "#EAF5FF" },
  authContent: { flexGrow: 1, justifyContent: "center", padding: 24 },
  logo: { fontSize: 32, fontWeight: "800", color: "#0878D1", textAlign: "center", marginBottom: 28 },
  authTitle: { fontSize: 27, fontWeight: "800", color: "#123451", textAlign: "center" },
  authSubtitle: { fontSize: 15, color: "#61778A", textAlign: "center", marginTop: 8, marginBottom: 26 },
  roleButton: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D4E3F0", borderRadius: 14, padding: 16, marginBottom: 12, gap: 12 },
  roleButtonActive: { borderColor: "#0878D1", backgroundColor: "#F0F8FF" },
  roleEmoji: { fontSize: 28 },
  roleTextContainer: { flex: 1 },
  roleTitle: { fontSize: 16, fontWeight: "700", color: "#123451" },
  roleDescription: { fontSize: 12, color: "#71869A", marginTop: 5, lineHeight: 17 },
  roleArrow: { fontSize: 23, color: "#0878D1", fontWeight: "800" },
  dealerNote: { color: "#71869A", fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 18 },
  dealerBanner: { backgroundColor: "#EAF5FF", borderColor: "#CFE4F5", borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 16 },
  dealerBannerTitle: { fontSize: 15, fontWeight: "800", color: "#123451" },
  dealerBannerText: { fontSize: 12, color: "#526579", lineHeight: 18, marginTop: 4 },
  warningText: { color: "#9A6700", fontSize: 12, lineHeight: 18, marginTop: 6 },
  logoutHeaderButton: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9, backgroundColor: "#FFF7F7" },
  input: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D4E3F0", borderRadius: 12, paddingHorizontal: 15, paddingVertical: 14, fontSize: 15, marginBottom: 14, color: "#123451" },
  readOnlyInput: { backgroundColor: "#EDF2F7", color: "#71869A" },
  primaryButton: { backgroundColor: "#0878D1", borderRadius: 11, minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, paddingVertical: 12, marginTop: 12 },
  smallPrimaryButton: { flex: 1, backgroundColor: "#0878D1", borderRadius: 9, minHeight: 40, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700", textAlign: "center" },
  disabledButton: { opacity: 0.65 },
  switchAuthButton: { marginTop: 22, alignItems: "center" },
  switchAuthText: { color: "#0878D1", fontSize: 14, fontWeight: "600", textAlign: "center" },
  header: { backgroundColor: "#FFFFFF", paddingTop: Platform.OS === "ios" ? 54 : 18, paddingHorizontal: 18, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#DFEAF3" },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  roundHeaderButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#EAF5FF", borderWidth: 1, borderColor: "#CFE4F5", alignItems: "center", justifyContent: "center" },
  roundHeaderButtonActive: { backgroundColor: "#D6EFFF", borderColor: "#0878D1" },
  roundHeaderIcon: { fontSize: 20 },
  logoSmall: { fontSize: 23, fontWeight: "800", color: "#0878D1" },
  headerSubtitle: { fontSize: 12, color: "#72869A", marginTop: 3 },
  logoutText: { color: "#D43C3C", fontWeight: "700", padding: 8 },
  logoutButtonFull: { borderWidth: 1, borderColor: "#D43C3C", borderRadius: 10, minHeight: 46, alignItems: "center", justifyContent: "center", padding: 12, marginTop: 12, backgroundColor: "#FFF7F7" },
  logoutButtonText: { color: "#D43C3C", fontSize: 15, fontWeight: "700" },
  helloText: { color: "#526579", fontSize: 13, marginTop: 14, marginBottom: 10 },
  navigation: { flexDirection: "row", gap: 8 },
  navButton: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 9, backgroundColor: "#F0F5F9" },
  navButtonActive: { backgroundColor: "#0878D1" },
  navText: { color: "#526579", fontWeight: "700" },
  navTextActive: { color: "#FFFFFF" },
  mainScroll: { flex: 1 },
  mainContent: { padding: 16, paddingBottom: 30 },
  sectionTitle: { fontSize: 23, fontWeight: "800", color: "#123451", marginBottom: 6 },
  sectionSubtitle: { fontSize: 14, color: "#71869A", marginBottom: 18 },
  loader: { marginVertical: 28 },
  productList: { gap: 15 },
  productCard: { backgroundColor: "#FFFFFF", borderRadius: 15, overflow: "hidden", borderWidth: 1, borderColor: "#E1EBF3" },
  productImage: { width: "100%", height: 190, backgroundColor: "#EAF5FF" },
  imagePlaceholder: { width: "100%", height: 190, backgroundColor: "#EAF5FF", alignItems: "center", justifyContent: "center" },
  placeholderText: { fontSize: 48 },
  productInfo: { padding: 15 },
  productName: { fontSize: 17, fontWeight: "700", color: "#123451" },
  productPrice: { fontSize: 18, fontWeight: "800", color: "#0878D1", marginTop: 5 },
  productDescription: { color: "#71869A", fontSize: 13, lineHeight: 19, marginTop: 8 },
  productActions: { flexDirection: "row", gap: 10, marginTop: 14 },
  outlineButton: { flex: 1, borderWidth: 1, borderColor: "#0878D1", borderRadius: 9, minHeight: 40, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  outlineButtonText: { color: "#0878D1", fontSize: 14, fontWeight: "700", textAlign: "center" },
  detailsCard: { backgroundColor: "#FFFFFF", borderRadius: 15, padding: 16, borderWidth: 1, borderColor: "#E1EBF3" },
  detailsImage: { width: "100%", height: 250, borderRadius: 12, backgroundColor: "#EAF5FF", marginBottom: 18 },
  detailsImagePlaceholder: { height: 220, backgroundColor: "#EAF5FF", borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  detailsPrice: { fontSize: 23, fontWeight: "800", color: "#0878D1", marginTop: 8 },
  detailsDescription: { fontSize: 15, lineHeight: 23, color: "#526579", marginTop: 14, marginBottom: 10 },
  outlineButtonFull: { borderWidth: 1, borderColor: "#0878D1", borderRadius: 10, minHeight: 46, alignItems: "center", justifyContent: "center", padding: 12, marginTop: 12 },
  cartItem: { backgroundColor: "#FFFFFF", borderRadius: 13, padding: 12, marginTop: 12, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: "#E1EBF3" },
  cartImage: { width: 76, height: 86, borderRadius: 9, backgroundColor: "#EAF5FF" },
  cartImagePlaceholder: { width: 76, height: 86, borderRadius: 9, backgroundColor: "#EAF5FF", alignItems: "center", justifyContent: "center" },
  cartItemInfo: { flex: 1 },
  quantityRow: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 10 },
  quantityButton: { width: 30, height: 30, borderRadius: 8, backgroundColor: "#EAF5FF", alignItems: "center", justifyContent: "center" },
  quantityButtonText: { color: "#0878D1", fontSize: 21, fontWeight: "700" },
  quantityText: { color: "#123451", fontWeight: "700", fontSize: 15 },
  itemTotal: { color: "#123451", fontSize: 13, fontWeight: "800" },
  totalCard: { backgroundColor: "#FFFFFF", padding: 16, borderRadius: 14, marginTop: 18, borderWidth: 1, borderColor: "#E1EBF3" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginVertical: 8 },
  totalLabel: { color: "#526579", fontSize: 15 },
  totalValue: { color: "#123451", fontWeight: "700" },
  totalAmount: { color: "#0878D1", fontSize: 22, fontWeight: "800" },
  mutedText: { color: "#71869A", fontSize: 12, lineHeight: 18, marginTop: 10 },
  messageCard: { backgroundColor: "#FFFFFF", borderRadius: 13, padding: 18, marginTop: 14, borderWidth: 1, borderColor: "#E1EBF3" },
  emptyText: { color: "#123451", fontSize: 16, fontWeight: "700", textAlign: "center", marginBottom: 8 },
  errorText: { color: "#B42318", fontSize: 14, lineHeight: 20 },
  orderCard: { backgroundColor: "#FFFFFF", borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#E1EBF3" },
  orderDivider: { height: 1, backgroundColor: "#E1EBF3", marginVertical: 12 },
  orderItem: { color: "#526579", fontSize: 14, lineHeight: 22, marginBottom: 4 },
  orderStatus: { color: "#0878D1", fontSize: 14, fontWeight: "700", marginTop: 8 },
  serviceFormCard: { backgroundColor: "#FFFFFF", borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#E1EBF3", marginTop: 12 },
  formLabel: { color: "#123451", fontSize: 14, fontWeight: "700", marginTop: 12, marginBottom: 8 },
  serviceOption: { borderWidth: 1, borderColor: "#D4E3F0", borderRadius: 9, padding: 12, marginBottom: 8, backgroundColor: "#FFFFFF" },
  serviceOptionSelected: { borderColor: "#0878D1", backgroundColor: "#EAF5FF" },
  serviceOptionText: { color: "#526579", fontSize: 14 },
  serviceOptionTextSelected: { color: "#0878D1", fontWeight: "700" },
  multilineInput: { minHeight: 82, textAlignVertical: "top" },
  serviceMessage: { color: "#28583D", fontSize: 13, lineHeight: 19, marginTop: 12 },
  serviceHistoryHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 26, marginBottom: 12 },
  footer: { backgroundColor: "#FFFFFF", borderTopWidth: 1, borderTopColor: "#DFEAF3", padding: 12, alignItems: "center" },
  footerText: { color: "#71869A", fontSize: 12 },
});
