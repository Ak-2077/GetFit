// import { Image } from 'expo-image';
// import { Platform, StyleSheet , Text } from 'react-native';

// import { HelloWave } from '@/components/hello-wave';
// import ParallaxScrollView from '@/components/parallax-scroll-view';
// import { ThemedText } from '@/components/themed-text';
// import { ThemedView } from '@/components/themed-view';
// import { Link } from 'expo-router';

// export default function HomeScreenBackup() {
//   return (
//     <ParallaxScrollView
//       headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }}
//       headerImage={
//         <Image
//           source={require('@/assets/images/partial-react-logo.png')}
//           style={styles.reactLogo}
//         />
//       }>
//       <ThemedView style={styles.titleContainer}>
//         <ThemedText type="title">Hello Abhishel</ThemedText>
//         <HelloWave />
//       </ThemedView>
//       <ThemedView style={[styles.stepContainer, styles.registerLinkContainer]}>
//         <Link href="/login">
//           <Link.Trigger>
//             <ThemedText type="subtitle">Sign in</ThemedText>
//           </Link.Trigger>
//           <Link.Preview />
//         </Link>
//         <ThemedText>{`Tap to open the login screen.`}</ThemedText>
//       </ThemedView>

//       <ThemedView style={[styles.stepContainer, styles.registerLinkContainer]}>
//         <Link href="/register">
//           <Link.Trigger>
//             <ThemedText type="subtitle">Create an account</ThemedText>
//           </Link.Trigger>
//           <Link.Preview />
//         </Link>
//         <ThemedText>{`Tap to open a simple registration screen.`}</ThemedText>
//       </ThemedView>
//     </ParallaxScrollView>
//   );
// }

// const styles = StyleSheet.create({
//   titleContainer: {
//     flexDirection: 'row',
//     alignItems: 'center',
//     gap: 8,
//   },
//   stepContainer: {
//     gap: 8,
//     marginBottom: 8,
//   },
//   registerLinkContainer: {
//     marginTop: 8,
//   },
//   reactLogo: {
//     height: 178,
//     width: 290,
//     bottom: 0,
//     left: 0,
//     position: 'absolute',
//   },
// });

export default function IndexBackupRoute() {
  return null;
}
